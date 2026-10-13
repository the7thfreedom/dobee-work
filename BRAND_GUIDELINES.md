# DobeeWork Brand Guidelines

English | [中文](BRAND_GUIDELINES.zh.md)

Current product names, interface text, model identity, packaging metadata, and maintained documentation use **DobeeWork**. The name does not imply endorsement by DeepSeek.

DobeeWork derives from [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Preserve accurate upstream references, citations, copyright notices, and third-party licenses. These identify their original subjects and must not be relabeled as DobeeWork.

Keep archived decision records, incident evidence, and committed historical Session generations unchanged. Refresh current expected output through its owning generator or recording workflow; do not rewrite historical inputs merely to remove an old product name.

Package names, SDK imports, `dsh`, `DSH_HOME`, provider identifiers, protocols, and user data paths remain technical identifiers. Changing them requires a separate compatibility and migration decision. DeepSeek model and API names identify a provider, not the DobeeWork product.

Use an independent `dobee` plugin for product-specific behavior or replacement brand components. Reviewed mechanical edits may change upstream wording, assets, and packaging metadata without changing behavior; do not copy entire upstream plugins.

The upstream brand plugin and its original assets remain available for upstream-specific compositions, but DobeeWork profiles use their replacement. Do not present upstream official assets as DobeeWork branding.

`pnpm run verify:dobee-branding` checks active text for the old display name. Its exact-file exceptions identify upstream material or historical evidence; each exception needs a reason and must not admit new product copy.
