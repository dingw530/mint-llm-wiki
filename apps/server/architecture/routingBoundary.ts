import path from 'node:path';
import ts from 'typescript';

export interface RoutingDependency {
  importer: string;
  target: string;
  typeOnly: boolean;
}

const DOMAIN = 'domains/routing/';
const INFRASTRUCTURE = new Set([
  'infrastructure/ai/jev-routing-provider.ts',
  'infrastructure/ai/llm-routing-classifier.ts',
  'infrastructure/persistence/routing-log-repository.ts',
  'infrastructure/persistence/routing-log-writer.ts',
]);

/** Evaluate resolved edges against the Routing domain and composition boundaries. */
export function routingBoundaryViolation(edge: RoutingDependency): string | null {
  const { importer, target, typeOnly } = edge;
  if (importer.includes('/__tests__/') || importer.endsWith('.test.ts')) return null;
  if (importer.startsWith(DOMAIN)) {
    if (target.startsWith(DOMAIN)) return null;
    if (typeOnly && target === 'types.ts') return null;
    if (['infrastructure/observability/logger.ts', 'utils/typeGuards.ts'].includes(target))
      return null;
    return 'Routing domain must use ports for configuration, models and persistence';
  }
  if (target.startsWith(DOMAIN)) {
    if (target !== `${DOMAIN}index.ts`) return 'Routing consumers must use the public index';
    if (INFRASTRUCTURE.has(importer) && !typeOnly)
      return 'Routing infrastructure may import only domain type contracts';
  }
  if (INFRASTRUCTURE.has(target)) {
    if (!importer.startsWith('bootstrap/') && !INFRASTRUCTURE.has(importer))
      return 'Routing infrastructure must be composed through bootstrap';
  }
  return null;
}

/** Read static imports, re-exports and literal dynamic imports, including type imports. */
function moduleReferences(source: ts.SourceFile): { specifier: string; typeOnly: boolean }[] {
  const references: { specifier: string; typeOnly: boolean }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      references.push({
        specifier: node.moduleSpecifier.text,
        typeOnly: node.importClause?.isTypeOnly === true,
      });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      references.push({ specifier: node.moduleSpecifier.text, typeOnly: node.isTypeOnly });
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      references.push({ specifier: node.arguments[0].text, typeOnly: false });
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      references.push({ specifier: node.argument.literal.text, typeOnly: true });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return references;
}

/** Resolve actual TypeScript module paths so deep relative paths cannot bypass the boundary. */
export function collectRoutingDependencies(serverRoot: string): RoutingDependency[] {
  const configPath = path.join(serverRoot, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error)
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, serverRoot);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const edges: RoutingDependency[] = [];
  const relative = (file: string): string =>
    path.relative(serverRoot, file).split(path.sep).join('/');
  for (const source of program.getSourceFiles()) {
    const importer = relative(source.fileName);
    if (source.isDeclarationFile || importer.startsWith('../')) continue;
    for (const reference of moduleReferences(source)) {
      const resolved = ts.resolveModuleName(
        reference.specifier,
        source.fileName,
        parsed.options,
        ts.sys,
      ).resolvedModule;
      if (!resolved) {
        if (importer.startsWith(DOMAIN) && reference.specifier.startsWith('.'))
          edges.push({
            importer,
            target: `unresolved:${reference.specifier}`,
            typeOnly: reference.typeOnly,
          });
        continue;
      }
      const target = relative(resolved.resolvedFileName);
      if (!target.startsWith('../')) edges.push({ importer, target, typeOnly: reference.typeOnly });
    }
  }
  return edges;
}
