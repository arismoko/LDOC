# LDOC Fidelity Test Harness

Internal development tool for testing LDOC decompile→recompile roundtrip fidelity.

## Quick Start

```bash
# Run all checks (console output)
bun fidelity/run.ts

# Generate HTML report
bun fidelity/run.ts --html

# Include visual (PDF) checks (requires LibreOffice)
bun fidelity/run.ts --visual

# Run single document
bun fidelity/run.ts cot_POWELL
```

## Corpus Setup

The harness supports two corpus locations:

### 1. Internal Corpus (committed to git)
Place DOCX files in `fidelity/corpus/docs/`

### 2. External Corpus (not committed)
Set the `LDOC_CORPUS_PATH` environment variable:

```bash
export LDOC_CORPUS_PATH="/path/to/your/docx/files"
bun fidelity/run.ts
```

Or create a `.env` file in the fidelity directory:
```
LDOC_CORPUS_PATH=/home/ari/Documents/legal-docs
```

## Manifest

The `corpus/manifest.json` file defines document metadata:

```json
{
  "documents": [
    {
      "id": "cot_POWELL",
      "file": "cot_POWELL.docx",
      "description": "Certificate of Trust",
      "tags": ["certificate", "single-page"],
      "expectedDifferences": []
    }
  ]
}
```

## Checks

- **Structural**: Paragraph count, table structure, style usage
- **Textual**: Content preservation, character count
- **Visual**: Page count via LibreOffice PDF (opt-in with `--visual`)

## Output

- Console: Quick pass/fail summary
- HTML: `artifacts/report.html` (self-contained, shareable)
- JSON: `artifacts/results.json` (for CI/automation)

## Artifacts

When tests fail, intermediate files are saved to `artifacts/docs/<id>/`:
- `decompiled.ldoc` - LDOC source from decompilation
- `recompiled.docx` - DOCX from recompilation
- `original.xml` / `recompiled.xml` - Document XML for comparison
- `*.pdf` - Rendered PDFs (if --visual)

## CI Usage

```yaml
- name: Run fidelity checks
  run: bun fidelity/run.ts --json
  continue-on-error: true

- name: Upload results
  uses: actions/upload-artifact@v3
  with:
    name: fidelity-results
    path: fidelity/artifacts/
```
