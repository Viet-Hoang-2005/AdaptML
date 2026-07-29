import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.resolve("src");
const displayProps = new Set([
  "title",
  "description",
  "subtitle",
  "label",
  "placeholder",
  "aria-label",
  "alt",
  "confirmText",
  "cancelText",
  "emptyText",
]);
const configProps = new Set([
  ...displayProps,
  "header",
  "message",
]);
const brands = new Set([
  "ML",
  "drift",
  "MLdrift",
  "Google",
  "GitHub",
  "MLflow",
  "Docker",
  "Kubernetes",
  "Kubeflow",
  "Scikit-learn",
  "XGBoost",
  "PyTorch",
  "TensorFlow",
]);

const files = [];
const visitDirectory = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "i18n") visitDirectory(absolute);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      files.push(absolute);
    }
  }
};
visitDirectory(root);

const failures = [];
const hasIgnoreComment = (sourceFile, node) => {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
  const lines = sourceFile.text.split(/\r?\n/);
  return [lines[start], lines[start - 1]]
    .filter(Boolean)
    .some((line) => line.includes("i18n-ignore:"));
};
const isTechnicalLiteral = (value) => {
  const text = value.trim();
  if (!/[A-Za-z]/.test(text)) return true;
  if (brands.has(text)) return true;
  if (/^&[A-Za-z]+;$/.test(text)) return true;
  if (/^\d+(?:K|m|h)$/.test(text)) return true;
  if (/^v\d+$/.test(text)) return true;
  if (/^(CPU|GPU|RAM|vCPU|API|URL|UUID|ID|HTTP|GET|POST|PUT|PATCH|DELETE)$/i.test(text)) return true;
  if (/^(https?:\/\/|\/dashboard\/|\/api\/|[.#][\w-]+|[\w-]+\.(py|csv|json|zip|pkl|joblib|txt|html))/.test(text)) return true;
  if (/^[\w@./:+-]+(?:==|>=|<=|~=|>|<)\d/.test(text)) return true;
  return false;
};
const report = (sourceFile, node, value, kind) => {
  if (isTechnicalLiteral(value) || hasIgnoreComment(sourceFile, node)) return;
  const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  failures.push(
    `${path.relative(process.cwd(), sourceFile.fileName)}:${location.line + 1}:${location.character + 1} ${kind}: ${JSON.stringify(value.trim())}`,
  );
};
const stringValue = (node) => {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
};
const isInsideCodeSample = (node) => {
  let current = node.parent;
  while (current) {
    if (
      ts.isJsxElement(current) &&
      ts.isIdentifier(current.openingElement.tagName) &&
      ["code", "pre"].includes(current.openingElement.tagName.text)
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
};
const isRenderedExpressionLiteral = (node) => {
  let current = node;
  while (current.parent && !ts.isJsxExpression(current.parent)) {
    const parent = current.parent;
    if (
      ts.isCallExpression(parent) &&
      ts.isIdentifier(parent.expression) &&
      parent.expression.text === "t"
    ) {
      return false;
    }
    if (ts.isConditionalExpression(parent)) {
      if (current === parent.condition) return false;
      current = parent;
      continue;
    }
    if (ts.isBinaryExpression(parent)) {
      const operator = parent.operatorToken.kind;
      if (
        operator !== ts.SyntaxKind.BarBarToken &&
        operator !== ts.SyntaxKind.QuestionQuestionToken &&
        operator !== ts.SyntaxKind.AmpersandAmpersandToken
      ) {
        return false;
      }
      if (operator === ts.SyntaxKind.AmpersandAmpersandToken && current === parent.left) {
        return false;
      }
      current = parent;
      continue;
    }
    if (
      ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isNonNullExpression(parent)
    ) {
      current = parent;
      continue;
    }
    return false;
  }
  return (
    current.parent &&
    ts.isJsxExpression(current.parent) &&
    !ts.isJsxAttribute(current.parent.parent)
  );
};

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const walk = (node) => {
    if (ts.isJsxText(node) && !isInsideCodeSample(node)) {
      const value = node.text.replace(/\s+/g, " ").trim();
      if (value) report(sourceFile, node, value, "JSX text");
    }

    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      !isInsideCodeSample(node) &&
      isRenderedExpressionLiteral(node)
    ) {
      report(sourceFile, node, node.text, "JSX expression");
    }

    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name)) {
      const name = node.name.text;
      if (displayProps.has(name) && node.initializer && ts.isStringLiteral(node.initializer)) {
        report(sourceFile, node, node.initializer.text, `JSX ${name}`);
      }
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const owner = node.expression.expression;
      const method = node.expression.name.text;
      if (
        ts.isIdentifier(owner) &&
        owner.text === "toast" &&
        ["success", "error", "warning", "info"].includes(method)
      ) {
        const value = node.arguments[0] ? stringValue(node.arguments[0]) : null;
        if (value) report(sourceFile, node.arguments[0], value, `toast.${method}`);
      }
    }

    if (
      file.endsWith(".tsx") &&
      ts.isPropertyAssignment(node) &&
      ((ts.isIdentifier(node.name) && configProps.has(node.name.text)) ||
        (ts.isStringLiteral(node.name) && configProps.has(node.name.text)))
    ) {
      const value = stringValue(node.initializer);
      if (value) report(sourceFile, node.initializer, value, `UI config ${node.name.getText(sourceFile)}`);
    }

    ts.forEachChild(node, walk);
  };
  walk(sourceFile);
}

if (failures.length > 0) {
  console.error("Hard-coded user-facing text detected. Use react-i18next or add a scoped `i18n-ignore: reason` comment.");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`i18n check passed across ${files.length} TypeScript modules.`);
