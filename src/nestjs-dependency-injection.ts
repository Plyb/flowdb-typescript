import ts, { ModifierLike, NodeArray, SyntaxKind } from 'typescript';
import { Config, ConfigSet, configSetJoinMap, configSetMap, singleConfig, unimplementedBottom } from './configuration';
import { isClassDeclaration, isDecorator, printNodeAndPos } from './ts-utils';
import { FixedEval } from './dcfa';
import { stackBottom } from './context';
import { structuralComparator } from './comparators';
import { SimpleSet } from 'typescript-super-set';
import { setFlatMap } from './setUtil';
import { AnalysisNode } from './abstract-values';
import { List, Set } from 'immutable'

type ThisAccessExpression = ts.PropertyAccessExpression & { expression: { kind: SyntaxKind.ThisKeyword} }
export function isThisAccessExpression(propertyAccessExpression: ts.PropertyAccessExpression): propertyAccessExpression is ThisAccessExpression {
    return propertyAccessExpression.expression.kind === SyntaxKind.ThisKeyword;
}

export function getDependencyInjected(dependencyAccess: Config<ThisAccessExpression>, typeChecker: ts.TypeChecker, fixed_eval: FixedEval): ConfigSet | false {
    const classSymbol = typeChecker.getSymbolAtLocation(dependencyAccess.node.expression);
    const classDeclaration = classSymbol?.valueDeclaration;
    if (classDeclaration === undefined) {
        return unimplementedBottom(`Could not find class declaration symbol of ${printNodeAndPos(dependencyAccess.node.expression)}`);
    }
    if (!ts.isClassDeclaration(classDeclaration)
        || !isDependencyInjectable(classDeclaration)
    ) {
        return false;
    }

    const dependencyNameSymbol = typeChecker.getSymbolAtLocation(dependencyAccess.node.name);
    const dependencyParam = dependencyNameSymbol?.valueDeclaration;
    if (dependencyParam === undefined) {
        return unimplementedBottom(`Unable to find the corresponding parameter to ${printNodeAndPos(dependencyAccess.node.name)}`);
    }
    if (!ts.isParameter(dependencyParam)) {
        if (ts.isMethodDeclaration(dependencyParam)) {
            return singleConfig(Config({ node: dependencyParam, env: List.of(stackBottom) }));
        }

        return getInitializersFromConstructor(dependencyParam, classDeclaration, fixed_eval);
    }

    const paramType = dependencyParam.type;
    if (paramType === undefined || !ts.isTypeReferenceNode(paramType)) {
        return unimplementedBottom(`Cannot inject a dependency without type reference for ${printNodeAndPos(dependencyParam)}`);
    }

    const classDeclarationOfDependency = fixed_eval(Config({ node: paramType.typeName, env: List.of(stackBottom) })); // assumes that all classes are declared at the top level of a file
    return configSetJoinMap(classDeclarationOfDependency, ({ node, env }) => {
        if (!isClassDeclaration(node)) {
            return unimplementedBottom(`Expected ${printNodeAndPos(node)} to be a class declaration`);
        }

        const dependencyInjectableDecorator = getDecoratorIndicatingDependencyInjectable(node);
        if (dependencyInjectableDecorator === undefined) {
            return unimplementedBottom(`Expected ${printNodeAndPos(node)} to have a decorator indicating that it is dependency injectable`)
        }
        
        return singleConfig(Config({ node: dependencyInjectableDecorator, env }));
    });
}

function getInitializersFromConstructor(declaration: ts.Declaration, classDeclaration: ts.ClassDeclaration, fixed_eval: FixedEval) {
    if (!ts.isPropertyDeclaration(declaration)) {
        return unimplementedBottom(`Expected ${printNodeAndPos(declaration)} to be a property declaration`);
    }

    const constructor = classDeclaration.members.find(ts.isConstructorDeclaration);
    if (constructor === undefined || constructor.body === undefined) {
        return unimplementedBottom(`Could not find constructor for ${printNodeAndPos(classDeclaration)}`);
    }
    const expressionStatements = constructor.body.statements.filter(ts.isExpressionStatement);
    const expressions = expressionStatements.map(statement => statement.expression);
    const binaryExpressions = expressions.filter(ts.isBinaryExpression);
    const assignmentsForDeclaration = binaryExpressions.filter(expression => {
        if (expression.operatorToken.kind !== SyntaxKind.EqualsToken) {
            return false;
        }

        const lhs = expression.left;
        if (!ts.isPropertyAccessExpression(lhs) || lhs.expression.kind !== SyntaxKind.ThisKeyword) {
            return false;
        }

        if (!ts.isIdentifier(declaration.name)) {
            return false;
        }

        return lhs.name.text === declaration.name.text
    });

    const assignmentsSet = Set.of(...assignmentsForDeclaration);

    return setFlatMap(assignmentsSet, assignment => fixed_eval(Config({ node: assignment.right, env: List.of(stackBottom) }))); // the env here isn't quite right, but unless the constructors have extra parameters, I don't think it will matter
}

function isDependencyInjectable(classDeclaration: ts.ClassDeclaration) {
    return hasDecoratorIndicatingDependencyInjectable(classDeclaration);
}

function hasDecoratorIndicatingDependencyInjectable(classDeclaration: ts.ClassDeclaration) {
    return !!getDecoratorIndicatingDependencyInjectable(classDeclaration);
} 

function getDecoratorIndicatingDependencyInjectable(classDeclaration: ts.ClassDeclaration) {
    const modifiers = classDeclaration.modifiers;
    if (modifiers === undefined) {
        return undefined;
    }
    return modifiers.find(isDecoratorIndicatingDependencyInjectable);
}

export function isDecoratorIndicatingDependencyInjectable(node: AnalysisNode): node is ts.Decorator {
    if (!isDecorator(node)) {
        return false;
    }

    const expression = node.expression;
    if (!ts.isCallExpression(expression)) {
        return false;
    }

    const nameExpression = expression.expression;
    if (!ts.isIdentifier(nameExpression)) {
        return false;
    }

    return nameExpression.text === 'Injectable' || nameExpression.text === 'Controller'
}
