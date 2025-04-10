import ts, { ArrowFunction, AsyncKeyword, BooleanLiteral, ConciseBody, Declaration, FalseLiteral, FunctionDeclaration, FunctionExpression, LiteralExpression, NullLiteral, SyntaxKind, TrueLiteral } from 'typescript';
import { SimpleSet } from 'typescript-super-set';
import { structuralComparator } from './comparators';
import path from 'path';
import fs from 'fs';
import { isExtern, NodeLatticeElem } from './abstract-values';
import { last } from 'lodash';
import { Config, Environment, newQuestion } from './configuration';
import { consList, unimplemented } from './util';


export type NodePrinter = (node: ts.Node) => string

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
    (FunctionDeclaration | FunctionExpression | ArrowFunction)
    & { body: ConciseBody }
type SimpleFunctionLikeDeclarationAsync = SimpleFunctionLikeDeclaration
    & { modifiers: [AsyncKeyword]}
export function isFunctionLikeDeclaration(node: NodeLatticeElem): node is SimpleFunctionLikeDeclaration {
    if (isExtern(node)) {
        return false;
    }

    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
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

type PrismaQueryExpression = {
    table: string,
    method: string,
    argument: ts.Node
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

    if (node.arguments.length !== 1) {
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

    if (!ts.isIdentifier(prismaTable.expression) || prismaTable.expression.text !== 'prisma') {
        return false;
    }

    return {
        table: prismaTable.name.text,
        method: querySignature.name.text,
        argument: node.arguments[0],
    }
}

export function isPrismaQuery(node: ts.Node): boolean {
    return !!getPrismaQuery(node);
}

export const Ambient = 2**25;


export function getService(rootFolder: string) {
    const configFile = ts.readConfigFile(path.join(rootFolder, 'tsconfig.json'), ts.sys.readFile);
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
export function printNodeAndPos(node: NodeLatticeElem): string {
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
    return `${line}:${character}:${last(sf.fileName.split('/'))}`
}

export function findAllCalls(node: ts.Node): Iterable<ts.CallExpression> {
    return findAll(node, ts.isCallExpression) as Iterable<ts.CallExpression>;
}

export function findAllParameterBinders(node: ts.Node) { // TODO mcfa we may want to extend this to other kinds of binders, but for now I'll do this
    const parentChain = [...getParentChain(node)];
    return parentChain.filter(node => isFunctionLikeDeclaration);
}

export function* getParentChain(node: ts.Node) {
    while (node !== undefined) {
        yield node;
        node = node.parent;
    }
}

type Scope = SimpleFunctionLikeDeclaration | ts.Block | ts.SourceFile;
export function getDeclaringScope(declaration: Declaration): Scope {
    if (ts.isParameter(declaration)) {
        if (!isFunctionLikeDeclaration(declaration.parent)) {
            throw new Error(`Unknown kind of signature declaration: ${printNodeAndPos(declaration.parent)}`)
        }
        return declaration.parent;
    } else if (ts.isVariableDeclaration(declaration)
        && ts.isVariableDeclarationList(declaration.parent)
        && ts.isVariableStatement(declaration.parent.parent)
    ) {
        const variableStatementParent = declaration.parent.parent.parent;
        if (!(ts.isBlock(variableStatementParent) || ts.isSourceFile(variableStatementParent))) {
            throw new Error(`Expected a statement to be in a block or sf: ${printNodeAndPos(variableStatementParent)}`);
        }
        return variableStatementParent;
    } else if (ts.isFunctionDeclaration(declaration)) {
        const declarationParent = declaration.parent;
        if (!(ts.isBlock(declarationParent) || ts.isSourceFile(declarationParent))) {
            throw new Error(`Expected a function declaration to be in a block or sf: ${printNodeAndPos(declarationParent)}`);
        }
        return declarationParent;
    } else {
        throw new Error(`Unknown declaring scope for ${printNodeAndPos(declaration)}`);
    }
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
    throw new Error(`Parent chain of id didn't include the declaring scope ${printNodeAndPos(config.node)}`);
}
