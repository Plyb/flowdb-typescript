import ts, { ArrowFunction, AssignmentExpression, AssignmentOperatorToken, AsyncKeyword, BooleanLiteral, ConciseBody, Declaration, FalseLiteral, FunctionDeclaration, FunctionExpression, LiteralExpression, MethodDeclaration, NullLiteral, StaticKeyword, SyntaxKind, TrueLiteral } from 'typescript';
import { SimpleSet } from 'typescript-super-set';
import { structuralComparator } from './comparators';
import path from 'path';
import fs from 'fs';
import { Cursor, isExtern } from './abstract-values';
import { last } from 'lodash';
import { Config, Environment, isConfigExtern, isConfigNoExtern } from './configuration';
import { getTsConfigAppPath, getTsConfigPath, toList, unimplemented } from './util';
import { stackBottom } from './context';


export function getNodeAtPosition(sourceFile: ts.SourceFile, position: number, length?: number): ts.Node | undefined {
    function find(node: ts.Node): ts.Node | undefined {
        if (position === node.getStart(sourceFile) && (length === undefined || node.end - node.pos === length)) {
            return node;
        }

        if (position >= node.getStart(sourceFile) && position < node.getEnd()) {
            return ts.forEachChild(node, find) || node;
        }
    }
    return find(sourceFile);
}

export function getReturnStatements(node: ts.Node): Iterable<ts.ReturnStatement> {
    return getStatements(node, ts.isReturnStatement);
}

export function getThrowStatements(node: ts.Node): Iterable<ts.ThrowStatement> {
    return getStatements(node, ts.isThrowStatement);
}

export function* getStatements<T extends ts.Node>(node: ts.Node, predicate: (node: ts.Node) => node is T): Iterable<T> {
    if (predicate(node)) {
        yield node;
    } else if (ts.isBlock(node) || ts.isCaseClause(node) || ts.isDefaultClause(node)) {
        for (const stmt of node.statements) {
            yield* getStatements(stmt, predicate);
        }
    } else if (ts.isIfStatement(node)) {
        yield* getStatements(node.thenStatement, predicate);
        if (node.elseStatement) {
            yield* getStatements(node.elseStatement, predicate);
        }
    } else if (ts.isIterationStatement(node, true)) {
        yield* getStatements(node.statement, predicate);
    } else if (ts.isSwitchStatement(node)) {
        for (const clause of node.caseBlock.clauses) {
            yield* getStatements(clause, predicate);
        }
    } else if (ts.isTryStatement(node)) {
        yield* getStatements(node.tryBlock, predicate);
        if (node.catchClause) {
            yield* getStatements(node.catchClause.block, predicate);
        }
        if (node.finallyBlock) {
            yield* getStatements(node.finallyBlock, predicate);
        }
    }
}

export type SimpleFunctionLikeDeclaration =
    (FunctionDeclaration | FunctionExpression | ArrowFunction | MethodDeclaration)
    & { body: ConciseBody }
type SimpleFunctionLikeDeclarationAsync = SimpleFunctionLikeDeclaration
    & { modifiers: [AsyncKeyword]}
export function isFunctionLikeDeclaration(node: Cursor): node is SimpleFunctionLikeDeclaration {
    if (isExtern(node)) {
        return false;
    }

    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)) {
        if (node.body === undefined) {
            throw new Error('should not have undefined function body');
        }
        return true;
    }
    return false;
}

export type AtomicLiteral = LiteralExpression | BooleanLiteral;
export function isLiteral(node: ts.Node): node is AtomicLiteral {
    return ts.isLiteralExpression(node) || isBooleaniteral(node);
}

export function isTrueLiteral(node: ts.Node): node is TrueLiteral {
    return node.kind === SyntaxKind.TrueKeyword;
}
export function isFalseLiteral(node: ts.Node): node is FalseLiteral {
    return node.kind === SyntaxKind.FalseKeyword;
}
export function isBooleaniteral(node: ts.Node): node is BooleanLiteral {
    return isTrueLiteral(node) || isFalseLiteral(node);
}
export function isAsyncKeyword(node: ts.Node | undefined): node is AsyncKeyword {
    return node?.kind === SyntaxKind.AsyncKeyword;
}
export function isAsync(node: SimpleFunctionLikeDeclaration): node is SimpleFunctionLikeDeclarationAsync {
    return node.modifiers?.some(isAsyncKeyword) ?? false;
}
export function isNullLiteral(node: ts.Node): node is NullLiteral {
    return node.kind === SyntaxKind.NullKeyword;
}
function isStaticKeyword(node: ts.Node | undefined): node is StaticKeyword {
    return node?.kind === SyntaxKind.StaticKeyword
}
export function isStatic(node: SimpleFunctionLikeDeclaration) {
    return node.modifiers?.some(isStaticKeyword) ?? false;
}
const assignmentOperators = [SyntaxKind.EqualsToken, SyntaxKind.PlusEqualsToken, SyntaxKind.MinusEqualsToken, SyntaxKind.AsteriskAsteriskEqualsToken, SyntaxKind.AsteriskEqualsToken, SyntaxKind.SlashEqualsToken, SyntaxKind.PercentEqualsToken, SyntaxKind.AmpersandEqualsToken, SyntaxKind.BarEqualsToken, SyntaxKind.CaretEqualsToken, SyntaxKind.LessThanLessThanEqualsToken, SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken, SyntaxKind.GreaterThanGreaterThanEqualsToken, SyntaxKind.BarBarEqualsToken, SyntaxKind.AmpersandAmpersandEqualsToken, SyntaxKind.QuestionQuestionEqualsToken];
export function isAssignmentExpression(node: ts.Node): node is AssignmentExpression<AssignmentOperatorToken> {
    return ts.isBinaryExpression(node) && assignmentOperators.includes(node.operatorToken.kind);
}export function isAssignmentExpressionConfig(config: Config): config is Config<AssignmentExpression<AssignmentOperatorToken>> {
    if (!isConfigNoExtern(config)) {
        return false;
    }

    return isAssignmentExpression(config.node);
}

export function* findAll(node: ts.Node, predicate: (node: ts.Node) => boolean): Iterable<ts.Node> {
    if (predicate(node)) {
        yield node;
    }

    if (isFunctionLikeDeclaration(node)) {
        return;
    }

    const childCalls = node.getChildren().flatMap(
        child => [...findAll(child, predicate)]
    );
    for (const childCall of childCalls) {
        yield childCall;
    }
}

export type PrismaQueryExpression = {
    table: string,
    method: string,
    argument: ts.Node | undefined
};

export function findAllPrismaQueryExpressions(node: ts.Node): SimpleSet<PrismaQueryExpression> {
    const tsNodePrismaQueryExpressions = findAll(node, node => !!getPrismaQuery(node));

    return new SimpleSet<PrismaQueryExpression>(
        structuralComparator,
        ...[...tsNodePrismaQueryExpressions].map(getPrismaQuery) as PrismaQueryExpression[]
    );
}

export function getPrismaQuery(node: ts.Node) : false | PrismaQueryExpression {
    if (!ts.isCallExpression(node)) {
        return false;
    }

    if (node.arguments.length > 1) {
        return false;
    }

    const querySignature = node.expression;
    if (!ts.isPropertyAccessExpression(querySignature)) {
        return false;
    }
    
    const prismaTable = querySignature.expression;
    if (!ts.isPropertyAccessExpression(prismaTable)) {
        return false;
    }

    if (!isPrimsaShaped(prismaTable.expression)) {
        return false;
    }

    return {
        table: prismaTable.name.text,
        method: querySignature.name.text,
        argument: node.arguments[0],
    }
}

function isPrimsaShaped(node: ts.Node) {
    if (ts.isIdentifier(node)
        && (node.text === 'prisma'
            || node.text === 'prismadb')
    ) {
        return true;
    }

    if (ts.isPropertyAccessExpression(node)
        && ts.isCallExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === 'db'
        && node.name.text === 'query'
    ) {
        return true;
    }

    if (ts.isPropertyAccessExpression(node)
        && node.expression.kind === SyntaxKind.ThisKeyword
        && node.name.text === '#prismaClient'
    ) {
        return true;
    }

    if (ts.isPropertyAccessExpression(node)
        && node.expression.kind === SyntaxKind.ThisKeyword
        && node.name.text === 'prisma'
    ) {
        return true;
    }

    if (ts.isPropertyAccessExpression(node)
        && node.expression.kind === SyntaxKind.ThisKeyword
        && node.name.text === 'prismaService'
    ) {
        return true;
    }
    
    if (ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && ts.isPropertyAccessExpression(node.expression.expression)
        && node.expression.expression.expression.kind === SyntaxKind.ThisKeyword
        && node.expression.expression.name.text === 'prismaService'
        && node.expression.name.text === 'txClient'
    ) {
        return true;
    }

    return false;
}

export function isPrismaQuery(node: ts.Node): boolean {
    return !!getPrismaQuery(node);
}

export const Ambient = 2**25;


export function getService(rootFolder: string) {
    const configFile = fs.existsSync(getTsConfigAppPath(rootFolder))
        ? ts.readConfigFile(getTsConfigAppPath(rootFolder), ts.sys.readFile)
        : ts.readConfigFile(getTsConfigPath(rootFolder), ts.sys.readFile);
    const { options, fileNames } = ts.parseJsonConfigFileContent(configFile.config, ts.sys, rootFolder);

    const files: ts.MapLike<{version: number}> = Object
        .fromEntries(fileNames.map(fileName => [fileName, { version: 0 }]));
    const servicesHost: ts.LanguageServiceHost = {
        getScriptFileNames: () => fileNames,
        getScriptVersion: fileName =>
            files[fileName] && files[fileName].version.toString(),
        getScriptSnapshot: fileName => {
            if (!fs.existsSync(fileName)) {
                return undefined;
            }

            return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName).toString());
        },
        getCurrentDirectory: () => process.cwd(),
        getCompilationSettings: () => ({...options, types: []}),
        getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
        fileExists: ts.sys.fileExists,
        readFile: ts.sys.readFile,
        readDirectory: ts.sys.readDirectory,
        directoryExists: ts.sys.directoryExists,
        getDirectories: ts.sys.getDirectories,
    };
    const service = ts.createLanguageService(servicesHost, ts.createDocumentRegistry());

    return service
}

const printer = ts.createPrinter();    
export function printNodeAndPos(node: Cursor): string {
    if (isExtern(node)) {
        return `EXTERNAL`;
    }

    return `${printNode(node)} @ ${getPosText(node)}`;
}
function printNode(node: ts.Node) {
    return printer.printNode(ts.EmitHint.Unspecified, node, node.getSourceFile());
}
export function getPosText(node: ts.Node) {
    const sf = node.getSourceFile();
    const { line, character } = ts.getLineAndCharacterOfPosition(sf, node.pos);
    return `${line + 1}:${character + 1}:${last(sf.fileName.split('/'))}`
}

export function findAllCalls(node: ts.Node): Iterable<ts.CallExpression> {
    return findAll(node, ts.isCallExpression) as Iterable<ts.CallExpression>;
}

export function findAllParameterBinders(node: ts.Node) {
    const parentChain = [...getParentChain(node)];
    return parentChain.filter(isFunctionLikeDeclaration);
}

export function* getParentChain(node: ts.Node) {
    while (node !== undefined) {
        yield node;
        node = node.parent;
    }
}

type Scope = SimpleFunctionLikeDeclaration | ts.Block | ts.SourceFile | ts.CatchClause | ts.ForOfStatement;
export function getDeclaringScope(declaration: Declaration, typeChecker: ts.TypeChecker): Scope {
    if (ts.isParameter(declaration)) {
        if (!isFunctionLikeDeclaration(declaration.parent)) {
            throw new Error(`Unknown kind of signature declaration: ${printNodeAndPos(declaration.parent)}`)
        }
        return declaration.parent;
    } else if (ts.isVariableDeclaration(declaration)) {
        if (ts.isVariableDeclarationList(declaration.parent)
        ) {
            if (ts.isVariableStatement(declaration.parent.parent)) {
                const variableStatementParent = declaration.parent.parent.parent;
                if (!(ts.isBlock(variableStatementParent) || ts.isSourceFile(variableStatementParent))) {
                    throw new Error(`Expected a statement to be in a block or sf: ${printNodeAndPos(variableStatementParent)}`);
                }
                return variableStatementParent;
            } else if (ts.isForOfStatement(declaration.parent.parent)) {
                return declaration.parent.parent;
            }
        } else if (ts.isCatchClause(declaration.parent)) {
            return declaration.parent;
        }
        throw new Error(`Unknown kind of variable declaration for finding scope: ${printNodeAndPos(declaration)}`)
    } else if (ts.isFunctionDeclaration(declaration) || ts.isClassDeclaration(declaration)) {
        const declarationParent = declaration.parent;
        if (!(ts.isBlock(declarationParent) || ts.isSourceFile(declarationParent))) {
            throw new Error(`Expected a function/class declaration to be in a block or sf: ${printNodeAndPos(declarationParent)}`);
        }
        return declarationParent;
    } else if (ts.isImportClause(declaration) || ts.isImportSpecifier(declaration) || ts.isNamespaceImport(declaration)) {
        return declaration.getSourceFile();
    } else if (ts.isBindingElement(declaration)) {
        const bindingElementSource = declaration.parent.parent;
        return getDeclaringScope(bindingElementSource, typeChecker);
    } else if (ts.isShorthandPropertyAssignment(declaration)) {
        const higherLevelDeclarationSymbol = typeChecker.getShorthandAssignmentValueSymbol(declaration);
        const higherLevelDeclaration = higherLevelDeclarationSymbol?.valueDeclaration ?? higherLevelDeclarationSymbol?.declarations?.[0];
        if (higherLevelDeclaration === undefined) {
            throw new Error(`Unable to find higher level declaration of shorthand property assignment ${printNodeAndPos(declaration)}`)
        }
        return getDeclaringScope(higherLevelDeclaration, typeChecker);
    } else if (ts.isMethodDeclaration(declaration) && ts.isClassDeclaration(declaration.parent)) {
        return getDeclaringScope(declaration.parent, typeChecker);
    }
    return unimplemented(`Unknown declaring scope for ${printNodeAndPos(declaration)}`, declaration.getSourceFile());
}

export function shortenEnvironmentToScope(config: Config<ts.Identifier>, scope: Scope): Environment {
    const parents = getParentChain(config.node);
    let env = config.env;
    for (const parent of parents) {
        if (parent === scope) {
            return env;
        }

        if (isFunctionLikeDeclaration(parent)) {
            env = env.tail;
        }
    }
    if (!ts.isSourceFile(scope)) {
        throw new Error(`Parent chain of id didn't include the declaring scope ${printNodeAndPos(config.node)}`);
    }
    return toList([stackBottom]); // This can happen if the declaring scope is another file altogether
}

export function getModuleSpecifier(importNode: ts.ImportSpecifier | ts.ImportClause | ts.NamespaceImport) {
    if (ts.isImportSpecifier(importNode)) {
        return importNode.parent.parent.parent.moduleSpecifier
    } else if (ts.isImportClause(importNode)) {
        return importNode.parent.moduleSpecifier;
    } else {
        return importNode.parent.parent.moduleSpecifier;
    }
}
