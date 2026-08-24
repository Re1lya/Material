#!/usr/bin/env python3
"""Apply the tested Ray 2.48 / vendor vLLM 0.23 compatibility shim.

The A3 vendor image intentionally owns vLLM and vLLM-Ascend.  Ray 2.48's
Serve LLM adapter targets an older vLLM API, so the runtime image patches only
that adapter and leaves the vendor inference stack unchanged.  Every
replacement is exact and fails the image build if the upstream file drifts.
"""

from pathlib import Path


TARGET = Path(
    "/usr/local/python3.12.13/lib/python3.12/site-packages/"
    "ray/llm/_internal/serve/deployments/llm/vllm/vllm_engine.py"
)


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return source.replace(old, new, 1)


def main() -> None:
    source = TARGET.read_text()

    source = replace_once(
        source,
        "import os\nimport re\n",
        "import asyncio\nimport inspect\nimport os\nimport re\n",
        "compat imports",
    )
    source = replace_once(
        source,
        """    async_engine_args = vllm.engine.arg_utils.AsyncEngineArgs(
        **engine_config.get_initialization_kwargs()
    )
""",
        """    initialization_kwargs = engine_config.get_initialization_kwargs()
    supported_args = inspect.signature(
        vllm.engine.arg_utils.AsyncEngineArgs
    ).parameters
    async_engine_args = vllm.engine.arg_utils.AsyncEngineArgs(
        **{
            key: value
            for key, value in initialization_kwargs.items()
            if key in supported_args
        }
    )
""",
        "AsyncEngineArgs filtering",
    )
    if source.count("vllm_envs.VLLM_USE_V1") != 2:
        raise RuntimeError("VLLM_USE_V1: expected two matches")
    source = source.replace(
        "vllm_envs.VLLM_USE_V1", 'getattr(vllm_envs, "VLLM_USE_V1", True)'
    )
    source = replace_once(
        source,
        """        self._atokenize = vllm_utils.make_async(
            self._tokenize, executor=self._tokenizer_executor
        )
""",
        """        if hasattr(vllm_utils, "make_async"):
            self._atokenize = vllm_utils.make_async(
                self._tokenize, executor=self._tokenizer_executor
            )
        else:
            async def _atokenize(prompt_text: str) -> List[int]:
                loop = asyncio.get_running_loop()
                return await loop.run_in_executor(
                    self._tokenizer_executor, self._tokenize, prompt_text
                )

            self._atokenize = _atokenize
""",
        "make_async fallback",
    )
    source = replace_once(
        source,
        """        from vllm.entrypoints.chat_utils import (
            resolve_chat_template_content_format as _resolve_chat_template_content_format,
        )

""",
        "",
        "removed chat resolver import",
    )
    source = replace_once(
        source,
        """        self.model_config = await self._engine_client.get_model_config()

        self._tokenizer = await self._engine_client.get_tokenizer()

        def resolve_chat_template_content_format(model_config, **kwargs):
            try:
                return _resolve_chat_template_content_format(
                    model_config=model_config, **kwargs
                )
            except TypeError:
                # Legacy API before vLLM 0.9.0.
                # TODO(#52975): Remove this try-except once vLLM <0.9.0 is no longer supported.
                return _resolve_chat_template_content_format(
                    trust_remote_code=model_config.trust_remote_code, **kwargs
                )

        self._resolved_content_format = resolve_chat_template_content_format(
            model_config=self.model_config,
            # Use HF to get the chat template so set it to None here.
            chat_template=None,
            # Default to None, change when it's needed.
            # vLLM does not have a high level API to support all of this.
            tools=None,
            # Let vLLM decide the content format.
            given_format="auto",
            tokenizer=self._tokenizer,
        )
""",
        """        self.model_config = self._engine_client.model_config
        self._tokenizer = self._engine_client.get_tokenizer()
        self._resolved_content_format = "string"
""",
        "engine client and tokenizer API",
    )
    source = replace_once(
        source,
        """        from vllm.entrypoints.chat_utils import (
            apply_hf_chat_template as _apply_hf_chat_template,
            parse_chat_messages_futures,
        )

        model_config = self.model_config
        mm_data = None

        if isinstance(prompt.prompt, list):
            messages = [m.model_dump() for m in prompt.prompt]
            conversation, mm_futures = parse_chat_messages_futures(
                messages=messages,
                model_config=model_config,
                tokenizer=self._tokenizer,
                content_format=self._resolved_content_format,
            )
            mm_data = await mm_futures

            def apply_hf_chat_template(model_config, **kwargs):
                try:
                    return _apply_hf_chat_template(model_config=model_config, **kwargs)
                except TypeError:
                    # Legacy API before vLLM 0.9.0.
                    # TODO(#52975): Remove above once vLLM <0.9.0 is no longer supported.
                    return _apply_hf_chat_template(
                        trust_remote_code=model_config.trust_remote_code, **kwargs
                    )

            prompt_text = apply_hf_chat_template(
                model_config=model_config,
                tokenizer=self._tokenizer,
                conversation=conversation,
                chat_template=None,
                tools=None,
                tokenize=False,
                # **kwargs for tokenizer.apply_chat_template
                trust_remote_code=model_config.trust_remote_code,
                add_generation_prompt=True,
                continue_final_message=False,
            )
        else:
            prompt_text = prompt.prompt
""",
        """        mm_data = None
        if isinstance(prompt.prompt, list):
            messages = [message.model_dump() for message in prompt.prompt]
            prompt_text = self._tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True,
            )
        else:
            prompt_text = prompt.prompt
""",
        "text chat template API",
    )
    source = replace_once(
        source,
        "if request_output.metrics is None:",
        """if request_output.metrics is None or not hasattr(
                    request_output.metrics, "time_in_queue"
                ):""",
        "request metrics fallback",
    )
    source = replace_once(
        source,
        "                best_of=sampling_params.best_of,\n",
        "",
        "removed SamplingParams.best_of",
    )

    TARGET.write_text(source)
    print(f"patched {TARGET}")


if __name__ == "__main__":
    main()
