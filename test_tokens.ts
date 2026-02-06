import { tokenize } from "./src/parse/lexer.ts";

const source = `[
[Simple paragraph with spaces.]
]`;

const result = tokenize(source);

console.log("Tokens:");
result.tokens.forEach((tok) => {
  console.log(`  ${tok.type.padEnd(20)} "${tok.value}" (line ${tok.line})`);
});

console.log("\nDiagnostics:");
result.diagnostics.forEach((diag) => {
  console.log(`  ${diag.message} (line ${diag.location.line})`);
});
