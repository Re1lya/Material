#!/usr/bin/env python3
import json
import threading
import unittest
import urllib.request

import capacity_checker
from capacity_checker import CapacityEvidenceError, Handler, ThreadingHTTPServer, parse_process_metrics


NOW_MS = 1_788_511_200_000


def sample(device_id, count=0, timestamp=NOW_MS):
    return (
        'npu_chip_info_process_info_num{container_name="",id="%s",'
        'namespace="",pod_name=""} %s %s' % (device_id, count, timestamp)
    )


def complete_sample():
    return '\n'.join(sample(index, 1 if index == 3 else 0) for index in range(16))


class ProcessMetricsTest(unittest.TestCase):
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

    def test_http_check_rejects_any_active_device_without_static_allocation(self):
        original = capacity_checker.host_processes
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        capacity_checker.host_processes = lambda: ['0']
        thread.start()
        try:
            payload = json.dumps({
                'deploymentName': 'qwen38-27b',
                'targetNode': 'a3-server-00',
                'targetDevices': 'dynamic-safe-pool',
                'requestedReplicas': 1,
                'npuPerWorker': 2,
            }).encode()
            request = urllib.request.Request(
                f'http://127.0.0.1:{server.server_port}/check',
                data=payload,
                method='POST',
                headers={'Content-Type': 'application/json'},
            )
            with urllib.request.urlopen(request, timeout=2) as response:
                result = json.loads(response.read())
            self.assertFalse(result['allowed'])
            self.assertEqual(result['hostProcessesOnDevices'], ['0'])
        finally:
            capacity_checker.host_processes = original
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    unittest.main()
