#!/usr/bin/env python3
import json
import threading
import unittest
import urllib.request

import capacity_checker
from capacity_checker import (
    CapacityEvidenceError,
    Handler,
    ThreadingHTTPServer,
    capacity_result,
    parse_device_pool,
    parse_process_metrics,
    select_devices,
)


NOW_MS = 1_788_511_200_000


def sample(device_id, count=0, timestamp=NOW_MS):
    return (
        'npu_chip_info_process_info_num{container_name="",id="%s",'
        'namespace="",pod_name=""} %s %s' % (device_id, count, timestamp)
    )


def complete_sample():
    return '\n'.join(sample(index, 1 if index == 3 else 0) for index in range(16))


class ProcessMetricsTest(unittest.TestCase):
    def test_exporter_metrics_url_accepts_only_ipv4_pod_ip(self):
        self.assertEqual(
            capacity_checker.exporter_metrics_url({"status": {"podIP": "10.42.17.5"}}),
            "http://10.42.17.5:8082/metrics",
        )
        with self.assertRaisesRegex(RuntimeError, "Pod IP is invalid"):
            capacity_checker.exporter_metrics_url({"status": {"podIP": "not-an-ip"}})
        with self.assertRaisesRegex(RuntimeError, "must be IPv4"):
            capacity_checker.exporter_metrics_url({"status": {"podIP": "fd00::1"}})

    def test_complete_fresh_sample_reports_active_devices(self):
        self.assertEqual(parse_process_metrics(complete_sample(), now_ms=NOW_MS), ['3'])

    def test_empty_metrics_never_allow_capacity(self):
        with self.assertRaises(CapacityEvidenceError):
            parse_process_metrics('', now_ms=NOW_MS)

    def test_missing_device_never_allow_capacity(self):
        metrics = '\n'.join(sample(index) for index in range(15))
        with self.assertRaises(CapacityEvidenceError):
            parse_process_metrics(metrics, now_ms=NOW_MS)

    def test_duplicate_or_stale_metric_never_allow_capacity(self):
        with self.assertRaises(CapacityEvidenceError):
            parse_process_metrics(complete_sample() + '\n' + sample(0), now_ms=NOW_MS)
        stale = '\n'.join(sample(index, timestamp=NOW_MS - 120_001) for index in range(16))
        with self.assertRaises(CapacityEvidenceError):
            parse_process_metrics(stale, now_ms=NOW_MS)

    def test_soft_pool_ignores_active_device_outside_the_pool(self):
        self.assertEqual(parse_device_pool('8,9,10,11'), ['8', '9', '10', '11'])
        self.assertEqual(select_devices(2, ['8', '9', '10', '11'], ['0']), ['8', '9'])
        result = capacity_result(2, ['8', '9', '10', '11'], ['0'])
        self.assertTrue(result['allowed'])
        self.assertEqual(result['selectedDevices'], ['Ascend910-8', 'Ascend910-9'])

    def test_soft_pool_skips_an_occupied_topology_block(self):
        result = capacity_result(2, ['8', '9', '10', '11'], ['8'])
        self.assertTrue(result['allowed'])
        self.assertEqual(result['selectedDevices'], ['Ascend910-10', 'Ascend910-11'])

    def test_soft_pool_rejects_when_no_complete_topology_block_is_free(self):
        result = capacity_result(2, ['8', '9', '10', '11'], ['8', '10'])
        self.assertFalse(result['allowed'])
        self.assertEqual(result['selectedDevices'], [])

    def test_device_pool_rejects_duplicates_and_invalid_ids(self):
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            parse_device_pool('8,8')
        with self.assertRaisesRegex(ValueError, 'invalid'):
            parse_device_pool('8,16')

    def test_http_check_returns_selected_static_devices(self):
        original = capacity_checker.host_processes
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        capacity_checker.host_processes = lambda: ['0']
        thread.start()
        try:
            payload = json.dumps({
                'deploymentName': 'qwen38-27b',
                'targetNode': 'a3-server-00',
                'targetDevices': 'configmap-soft-pool',
                'targetDeviceIds': '8,9,10,11',
                'requestedReplicas': 1,
                'npuPerWorker': 2,
            }).encode()
            request = urllib.request.Request(
                f'http://127.0.0.1:{server.server_port}/check',
                data=payload,
                method='POST',
                headers={'Content-Type': 'application/json'},
            )
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(request, timeout=2) as response:
                result = json.loads(response.read())
            self.assertTrue(result['allowed'])
            self.assertEqual(result['hostProcessesOnDevices'], ['0'])
            self.assertEqual(result['selectedDevices'], ['Ascend910-8', 'Ascend910-9'])
        finally:
            capacity_checker.host_processes = original
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    unittest.main()
