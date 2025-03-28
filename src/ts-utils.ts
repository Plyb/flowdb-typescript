import ts, { ArrowFunction, AsyncKeyword, BooleanLiteral, FalseLiteral, FunctionDeclaration, FunctionExpression, LiteralExpression, NullLiteral, SyntaxKind, TrueLiteral } from 'typescript';
import { SimpleSet } from 'typescript-super-set';
import { structuralComparator } from './comparators';


export function getNodeAtPosition(sourceFile: ts.SourceFile, position: number): ts.Node | undefined {
    function find(node: ts.Node): ts.Node | undefined {
        if (position >= node.getStart(sourceFile) && position < node.getEnd()) {
            return ts.forEachChild(node, find) || node;
        }
    }
    return find(sourceFile);
}

export function* getReturnStmts(node: ts.Node): Iterable<ts.ReturnStatement> {
    if (ts.isReturnStatement(node)) {
        yield node;
    } else if (ts.isBlock(node) || ts.isCaseClause(node) || ts.isDefaultClause(node)) {
        for (const stmt of node.statements) {
            yield* getReturnStmts(stmt);
        }
    } else if (ts.isIfStatement(node)) {
        yield* getReturnStmts(node.thenStatement);
        if (node.elseStatement) {
            yield* getReturnStmts(node.elseStatement);
        }
    } else if (ts.isIterationStatement(node, true)) {
        yield* getReturnStmts(node.statement);
    } else if (ts.isSwitchStatement(node)) {
        for (const clause of node.caseBlock.clauses) {
            yield* getReturnStmts(clause);
        }
    } else if (ts.isTryStatement(node)) {
        yield* getReturnStmts(node.tryBlock);
        if (node.catchClause) {
            yield* getReturnStmts(node.catchClause.block);
        }
        if (node.finallyBlock) {
            yield* getReturnStmts(node.finallyBlock);
        }
    }
}


export type SimpleFunctionLikeDeclaration =
    (FunctionDeclaration | FunctionExpression | ArrowFunction)
    & { body: ts.Node }
type SimpleFunctionLikeDeclarationAsync = SimpleFunctionLikeDeclaration
    & { modifiers: [AsyncKeyword]}
export function isFunctionLikeDeclaration(node: ts.Node): node is SimpleFunctionLikeDeclaration {
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
    if (node.modifiers?.slice(1).some(isAsyncKeyword)) {
        console.warn('Async keyword found in non-0 position')
    }
    return isAsyncKeyword(node.modifiers?.[0]) ?? false;
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

export const Ambient = 2**25;
