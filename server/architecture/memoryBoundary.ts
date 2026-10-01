import path from 'node:path';
import ts from 'typescript';

export interface MemoryDependencyEdge {
  importer: string;
  specifier: string;
  target: string;
  typeOnly: boolean;
}

export interface MemoryBoundaryViolation extends MemoryDependencyEdge {
  reason: string;
}

interface ImportReference {
  specifier: string;
  typeOnly: boolean;
}

function normalizePath(value: string): string {
  return value.split(path.sep).join('/');
}

function isWithin(filePath: string, directory: string): boolean {
  const relativePath = path.relative(directory, filePath);
  return (
    relativePath === '' || (!relativePath.startsWith(`..${path.sep}`) && relativePath !== '..')
  );
}

function isMemorySource(filePath: string, memoryRoot: string): boolean {
  return (
    isWithin(filePath, memoryRoot) &&
    !filePath.split(path.sep).includes('__tests__') &&
    !/\.(test|spec)\.tsx?$/.test(filePath)
  );
}

function isInfrastructureSource(filePath: string, infrastructureRoot: string): boolean {
  return isWithin(filePath, infrastructureRoot);
}

function isMemoryInfrastructurePath(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return (
    normalized.startsWith('infrastructure/persistence/memory') ||
    normalized.startsWith('infrastructure/ai/memory')
  );
}

function readImportReferences(source: ts.SourceFile): ImportReference[] {
  const references: ImportReference[] = [];
  const addReference = (specifier: ts.Expression, typeOnly: boolean): void => {
    if (ts.isStringLiteralLike(specifier)) {
      references.push({ specifier: specifier.text, typeOnly });
    }
  };

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
      node.arguments.length === 1
    ) {
      addReference(node.arguments[0], false);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      addReference(node.argument.literal, true);
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return references;
}

function resolveReference(
  reference: ImportReference,
  importer: string,
  compilerOptions: ts.CompilerOptions,
): string | null {
  return (
    ts.resolveModuleName(reference.specifier, importer, compilerOptions, ts.sys).resolvedModule
      ?.resolvedFileName ?? null
  );
}

function isAllowedDomainDependency(edge: MemoryDependencyEdge): boolean {
  if (edge.target.startsWith('external:')) return true;
  const targetRelative = normalizePath(edge.target);
  if (targetRelative.startsWith('domains/memory/') || targetRelative.startsWith('infrastructure/'))
    return true;
  if (targetRelative === 'types.ts' && edge.typeOnly) return true;
  return targetRelative === 'services/utils/tokenEstimator.ts';
}

/** Collect resolved static and literal dynamic dependencies that cross Memory's public boundary. */
export function collectMemoryDependencyEdges(serverRootInput: string): MemoryDependencyEdge[] {
  const serverRoot = path.resolve(serverRootInput);
  const configPath = path.join(serverRoot, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  }
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    serverRoot,
    undefined,
    configPath,
  );
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const memoryRoot = path.join(serverRoot, 'domains', 'memory');
  const edges: MemoryDependencyEdge[] = [];

  for (const source of program.getSourceFiles()) {
    const importer = path.resolve(source.fileName);
    if (!isWithin(importer, serverRoot) || source.isDeclarationFile) continue;
    const memorySource = isMemorySource(importer, memoryRoot);
    if (!memorySource) continue;

    for (const reference of readImportReferences(source)) {
      const target = resolveReference(reference, importer, parsed.options);
      if (!target) {
        if (reference.specifier.startsWith('.')) {
          edges.push({
            importer: normalizePath(path.relative(serverRoot, importer)),
            specifier: reference.specifier,
            target: `unresolved:${reference.specifier}`,
            typeOnly: reference.typeOnly,
          });
        }
        continue;
      }
      if (!isWithin(target, serverRoot)) continue;
      const targetRelative = normalizePath(path.relative(serverRoot, target));
      if (targetRelative === 'types.ts' && !reference.typeOnly) {
        edges.push({
          importer: normalizePath(path.relative(serverRoot, importer)),
          specifier: reference.specifier,
          target: targetRelative,
          typeOnly: false,
        });
        continue;
      }
      const edge: MemoryDependencyEdge = {
        importer: normalizePath(path.relative(serverRoot, importer)),
        specifier: reference.specifier,
        target: targetRelative,
        typeOnly: reference.typeOnly,
      };
      if (isMemorySource(target, memoryRoot) || isMemoryInfrastructurePath(targetRelative)) {
        edges.push(edge);
      } else if (!isAllowedDomainDependency(edge)) {
        edges.push(edge);
      }
    }
  }

  for (const source of program.getSourceFiles()) {
    const importer = path.resolve(source.fileName);
    if (
      !isWithin(importer, serverRoot) ||
      source.isDeclarationFile ||
      isMemorySource(importer, memoryRoot)
    )
      continue;
    for (const reference of readImportReferences(source)) {
      const target = resolveReference(reference, importer, parsed.options);
      if (!target || !isWithin(target, memoryRoot)) continue;
      const targetRelative = normalizePath(path.relative(serverRoot, target));
      if (targetRelative === 'domains/memory/index.ts') continue;
      edges.push({
        importer: normalizePath(path.relative(serverRoot, importer)),
        specifier: reference.specifier,
        target: targetRelative,
        typeOnly: reference.typeOnly,
      });
    }
  }
  return edges;
}

/** Return violations for Memory dependencies and require outside consumers to use the public index. */
export function findMemoryBoundaryViolations(
  edges: readonly MemoryDependencyEdge[],
  serverRootInput: string,
): MemoryBoundaryViolation[] {
  const serverRoot = path.resolve(serverRootInput);
  const memoryRoot = path.join(serverRoot, 'domains', 'memory');
  const infrastructureRoot = path.join(serverRoot, 'infrastructure');
  return edges.flatMap((edge) => {
    if (edge.target.startsWith('unresolved:')) {
      return [{ ...edge, reason: 'Memory contains an unresolved relative import' }];
    }
    const importer = path.resolve(serverRoot, edge.importer);
    const target = path.resolve(serverRoot, edge.target);
    const importerRelative = normalizePath(path.relative(serverRoot, importer));
    const targetRelative = normalizePath(path.relative(serverRoot, target));
    if ((importerRelative === 'types.ts' || targetRelative === 'types.ts') && edge.typeOnly)
      return [];
    if (isMemoryInfrastructurePath(targetRelative)) {
      return isWithin(importer, memoryRoot) ||
        isWithin(importer, path.join(serverRoot, 'bootstrap'))
        ? []
        : [
            {
              ...edge,
              reason:
                'Memory-specific infrastructure may be accessed only by its domain or bootstrap',
            },
          ];
    }
    if (isMemorySource(importer, memoryRoot)) {
      return isAllowedDomainDependency(edge)
        ? []
        : [
            {
              ...edge,
              reason:
                'Memory domain may depend only on itself, infrastructure, type-only server types, and the shared token estimator',
            },
          ];
    }
    if (isInfrastructureSource(importer, infrastructureRoot)) {
      if (
        isWithin(target, memoryRoot) &&
        edge.typeOnly &&
        [
          'domains/memory/index.ts',
          'domains/memory/types.ts',
          'domains/memory/gates/index.ts',
        ].includes(targetRelative)
      ) {
        return [];
      }
      return isWithin(target, memoryRoot)
        ? [{ ...edge, reason: 'Infrastructure may import only type contracts from Memory' }]
        : [];
    }
    return isWithin(target, memoryRoot) && targetRelative !== 'domains/memory/index.ts'
      ? [{ ...edge, reason: 'Consumers must import Memory through domains/memory/index.ts' }]
      : [];
  });
}
