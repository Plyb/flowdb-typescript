import ts, { CallExpression, Expression, Node, ParenthesizedExpression, ObjectLiteralElementLike, SyntaxKind, PreProcessedFileInfo } from 'typescript';
import { SimpleSet } from 'typescript-super-set';
import { empty, setFlatMap, setMap, singleton, unionAll } from './setUtil';
import { FixRunFunc, valueOf } from './fixpoint';
import { structuralComparator } from './comparators';
import { getNodeAtPosition, getReturnStmts, isFunctionLikeDeclaration, isLiteral as isAtomicLiteral, SimpleFunctionLikeDeclaration, isAsync, getPrismaQuery } from './ts-utils';
import { AbstractArray, AbstractObject, AbstractValue, bot, botValue } from './abstract-values';
import { AbstractResult, arrayResult, botResult, getObjectProperty, join, joinAll, joinStores, literalResult, nodeResult, nodesResult, objectResult, primopResult, promiseResult, resolvePromise, setJoinMap, topResult } from './abstract-results';
import { isBareSpecifier } from './util';
import { primopFecth, PrimopId, primopJSON, primopMath, primops } from './primops';
import { packageZod } from './zodPackage';

export function dcfa(node: ts.Node, service: ts.LanguageService) {
    const program = service.getProgram()!;
    const typeChecker = program.getTypeChecker();
    const printer = ts.createPrinter();

    if (node === undefined) {
        throw new Error('no node at that position')
    }
    console.log(`dcfa for: ${printNode(node)}`)

    return valueOf({
        func: abstractEval,
        args: node,
    }, botResult);

    // "eval"
    function abstractEval(node: ts.Node, fix_run: FixRunFunc<ts.Node, AbstractResult>): AbstractResult {
        console.info(`abstractEval: ${printNode(node)}`);
        
        const overriddenResult = getOverriddenResult(node);
        if (overriddenResult) {
            return overriddenResult;
        }

        if (isFunctionLikeDeclaration(node)) {
            return nodeResult(node);
        } else if (ts.isCallExpression(node)) {
            const operator: ts.Node = node.expression;
            const possibleOperators = fix_run(abstractEval, operator).value;

            const possibleFunctions = possibleOperators.nodes;
            const valuesOfFunctionBodies = setJoinMap(possibleFunctions, (func) => {
                if (!isFunctionLikeDeclaration(func)) {
                    return botResult;
                }

                const body: ts.Node = func.body;
                const result = fix_run(abstractEval, body);
                if (isAsync(func)) {
                    return promiseResult(func, result);
                } else {
                    return result;
                }
            });

            const possiblePrimops = possibleOperators.primops;
            if (possiblePrimops.size() === 0) {
                return valuesOfFunctionBodies; // short circuit to prevent expensive computations
            }
            const thisResult = ts.isPropertyAccessExpression(node.expression)
                ? fix_run(abstractEval, node.expression.expression)
                : botResult;
            const argumentValues = node.arguments.map(arg => fix_run(abstractEval, arg));
            const valuesOfPrimopExpresssions = setJoinMap(possiblePrimops, (primopId) =>
                applyPrimop(node, primopId, thisResult, argumentValues)
            );

            return join(valuesOfFunctionBodies, valuesOfPrimopExpresssions);
        } else if (ts.isIdentifier(node)) {
            const boundExprs = getBoundExprs(node, fix_run);
            return setJoinMap(boundExprs, boundExpr => fix_run(abstractEval, boundExpr));
        } else if (ts.isParenthesizedExpression(node)) {
            return fix_run(abstractEval, node.expression);
        } else if (ts.isBlock(node)) {
            const returnStatements = [...getReturnStmts(node)];
            const returnStatementValues = returnStatements.map(returnStatement => {
                if (returnStatement.expression === undefined) {
                    throw new Error('return statement should have expression');   
                }
                return fix_run(abstractEval, returnStatement.expression);
            });
            return joinAll(...returnStatementValues);
        } else if (isAtomicLiteral(node)) {
            return literalResult(node);
        } else if (ts.isObjectLiteralExpression(node)) {
            return evalObject(node);
        } else if (ts.isPropertyAccessExpression(node)) {
            if (!ts.isIdentifier(node.name)) {
                throw new Error(`Expected simple identifier property access: ${node.name}`);
            }

            const expressionResult = fix_run(abstractEval, node.expression);
            const propertyAccessResult = getObjectProperty(expressionResult, node.name);
            if (propertyAccessResult !== botResult) {
                return propertyAccessResult;
            }

            const primop = getPrimitivePrimop(expressionResult, node.name.text);
            return primop
                ? primopResult(primop)
                : botResult;
        } else if (ts.isAwaitExpression(node)) {
            const expressionValue = fix_run(abstractEval, node.expression);
            return resolvePromise(expressionValue);
        } else if (ts.isArrayLiteralExpression(node)) {
            return evalArray(node);
        } else if (ts.isImportClause(node) || ts.isImportSpecifier(node)) {
            /**
             * I think we should only get here if we're trying to eval something that
             * depends on an imported package that uses a bare specifier (or the client
             * has directly requested the value of an import statement). In that case,
             * for simplicity's sake for now, we're just going to say it could be anything.
             */
            return topResult;
        }
        throw new Error(`not yet implemented: ${ts.SyntaxKind[node.kind]}`);

        function evalObject(node: ts.ObjectLiteralExpression): AbstractResult {
            const { object, stores } = node.properties.reduce((acc, curr) => {
                if (curr.name === undefined || !ts.isIdentifier(curr.name)) {
                    throw new Error(`expected identifier for property name: ${curr.name}`)
                }

                if (!ts.isPropertyAssignment(curr)) {
                    throw new Error(`expected simple property assignment: ${curr}`);
                }

                const result = fix_run(abstractEval, curr.initializer);
                acc.object[curr.name.text] = result.value;
                acc.stores = joinStores(acc.stores, result);
                return acc;
            }, { object: {}, stores: botResult });

            return objectResult(node, object, stores);
        }

        function evalArray(node: ts.ArrayLiteralExpression): AbstractResult {
            const itemValue = setJoinMap(new SimpleSet(structuralComparator, ...node.elements), (elem) => 
                fix_run(abstractEval, elem)
            );

            return arrayResult(node, itemValue);
        }
    }
    
    function isOperatorOf(op: ts.Node, call: ts.CallExpression) {
        return op === call.expression;
    }
    
    function getArgumentIndex(call: ts.CallExpression, arg: ts.Node) {
        return call.arguments.indexOf(arg as Expression);
    }
    
    // "expr"
    function getWhereValueApplied(node: ts.Node, fix_run: FixRunFunc<Node, AbstractResult>): AbstractResult {
        console.info(`getWhereValueApplied: ${printNode(node)}`);
        if (ts.isCallExpression(node.parent)) {
            const parent = node.parent;
            if (isOperatorOf(node, parent)) {
                return nodeResult(parent);
            } else {
                const argIndex = getArgumentIndex(parent, node);
                const possibleFunctions = fix_run(
                    abstractEval, parent.expression
                ).value.nodes as any as SimpleSet<SimpleFunctionLikeDeclaration>;
                const parameterReferences = setJoinMap(
                    possibleFunctions,
                    (func) => nodesResult(getReferences(func.parameters[argIndex].name))
                ).value.nodes;
                return setJoinMap(parameterReferences, (parameterRef) => fix_run(getWhereValueApplied, parameterRef));
            }
        } else if (isFunctionLikeDeclaration(node.parent)) {
            const closedOverSites = fix_run(getWhereClosed, node).value.nodes;
            return setJoinMap(closedOverSites, site => fix_run(getWhereValueApplied, site));
        } else if (ts.isParenthesizedExpression(node.parent)) {
            return fix_run(getWhereValueApplied, node.parent);
        } else if (ts.isVariableDeclaration(node.parent)) {
            const refs = getReferences(node.parent.name)
            return setJoinMap(refs, ref => fix_run(getWhereValueApplied, ref));
        } else if (ts.isFunctionDeclaration(node)) { // note that this is a little weird since we're not looking at the parent
            if (node.name === undefined) {
                throw new Error('function declaration should have name')
            }

            const refs = getReferences(node.name);
            return setJoinMap(refs, ref => fix_run(getWhereValueApplied, ref));
        }
        throw new Error(`not yet implemented: ${ts.SyntaxKind[node.parent.kind]}`)
    }
    
    // "call"
    function getWhereClosed(node: ts.Node, fix_run: FixRunFunc<ts.Node, AbstractResult>): AbstractResult {
        console.info(`getWhereClosed: ${printNode(node)}`);
        if (!isFunctionLikeDeclaration(node.parent)) {
            return botResult;
        }

        return fix_run(getWhereValueApplied, node.parent)
    }
    
    // "find"
    function getReferences(id: ts.Node): SimpleSet<ts.Node> {
        console.info(`getReferences: ${printNode(id)}`);
        if (!ts.isIdentifier(id)) {
            throw new Error("can't find references of non-identifier");
        }

        const refs = service
            .findReferences(id.getSourceFile().fileName, id.getStart())
            ?.flatMap(ref => ref.references)
            ?.filter(ref => !ref.isDefinition);
        if (refs === undefined) {
            throw new Error('undefined references');
        }
        const refNodes = refs.map(ref => getNodeAtPosition(
            program.getSourceFile(ref.fileName)!,
            ref.textSpan?.start!
        )!);
        return new SimpleSet<Node>(structuralComparator, ...refNodes);
    }
    
    // bind
    function getBoundExprs(id: ts.Identifier, fix_run: FixRunFunc<ts.Node, AbstractResult>): SimpleSet<ts.Node> {
        console.info(`getBoundExprs: ${printNode(id)}`);
        const symbol = typeChecker.getSymbolAtLocation(id);
        const declaration = symbol?.valueDeclaration
            ?? symbol?.declarations?.[0]; // it seems like this happens when the declaration is an import clause
        if (declaration === undefined) {
            throw new Error('could not find declaration');
        }

        if (ts.isParameter(declaration)) {
            if (!isFunctionLikeDeclaration(declaration.parent)) {
                throw new Error('not yet implemented');
            }
            const parameterIndex = declaration.parent.parameters.indexOf(declaration);
            const definingFunctionBody = declaration.parent.body
    
            const definingFunctionCallSites = fix_run(
                getWhereClosed, definingFunctionBody
            ).value.nodes as any as SimpleSet<CallExpression>;
            return setMap(definingFunctionCallSites, (callSite) => {
                return callSite.arguments[parameterIndex] as Node;
            });
        } else if (ts.isVariableDeclaration(declaration)) {
            if (declaration.initializer === undefined) {
                throw new Error('Variable declaration should have initializer')
            }

            return singleton<Node>(declaration.initializer);
        } else if (ts.isFunctionDeclaration(declaration)) {
            return singleton<Node>(declaration);
        } else if (ts.isBindingElement(declaration)) {
            const initializer = declaration.parent.parent.initializer;
            if (initializer === undefined) {
                throw new Error('Variable declaration should have initializer')
            }

            return singleton<Node>(ts.factory.createPropertyAccessExpression(initializer, id));
        } else if (ts.isImportClause(declaration) || ts.isImportSpecifier(declaration)) {
            const moduleSpecifier = ts.isImportClause(declaration)
                ? declaration.parent.moduleSpecifier
                : declaration.parent.parent.parent.moduleSpecifier;

            if (!ts.isStringLiteral(moduleSpecifier)) {
                throw new Error('Module specifier must be a string literal');
            }

            if (isBareSpecifier(moduleSpecifier.text)) {
                /**
                 * This is a little bit of a hack. Here we're saying "bare specified modules
                 * (those that are imported as packages) are 'bound' by themselves", which
                 * abstractEval will interpret as `topResult`, so that we don't need to dig
                 * into a bunch of package internals. Maybe I'll come up with a better way
                 * later, but this is good enough for now.
                 */
                return singleton<Node>(declaration);
            }

            throw new Error('Non-bare specifiers are not yet implemented');
        }
        throw new Error(`not yet implemented: ${ts.SyntaxKind[declaration.kind]}`);
    }

    function printNode(node: ts.Node) {
        const sf = ts.createSourceFile('temp.ts', '', ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
        return printer.printNode(ts.EmitHint.Unspecified, node, sf);
    }
}

function getOverriddenResult(node: ts.Node): false | AbstractResult {
    const prismaQueryExpression = getPrismaQuery(node);
    if (prismaQueryExpression) {
        return botResult; // For now, just returning bot result until I need something fancier
    }

    // in the long run, probably need a better way than just checking ids, since ids are used all over the place
    if (ts.isIdentifier(node)) {
        if (node.text === 'Math') {
            return primopMath;
        } else if (node.text === 'fetch') {
            return primopFecth;
        } else if (node.text === 'JSON') {
            return primopJSON;
        } else if (node.text === 'z') {
            return packageZod;
        }
    }

    return false;
}

function applyPrimop(callExpression: ts.CallExpression, primopId: PrimopId, thisRes: AbstractResult, args: AbstractResult[]): AbstractResult {
    return primops[primopId].apply(thisRes, [callExpression, ...args]);
}

function getPrimitivePrimop(res: AbstractResult, name: string): false | PrimopId {
    const primopIds = Object.keys(primops);

    if (res.value.strings !== bot) {
        const stringPrimops = primopIds.filter(id => id.split('#')[0] === 'String');
        return stringPrimops.find(id => id.split('#')[1] === name) as PrimopId ?? false;
    }

    return false;
}
