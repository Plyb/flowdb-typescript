import ts, { CallExpression, Expression, Node, SyntaxKind, ParameterDeclaration, ObjectLiteralExpression, Identifier, PropertyAssignment, ShorthandPropertyAssignment, ArrayLiteralExpression } from 'typescript';
import { SimpleSet } from 'typescript-super-set';
import { empty, setMap, singleton } from './setUtil';
import { FixRunFunc, makeFixpointComputer } from './fixpoint';
import { structuralComparator } from './comparators';
import { getNodeAtPosition, getReturnStmts, isFunctionLikeDeclaration, isLiteral as isAtomicLiteral, SimpleFunctionLikeDeclaration, isAsync, isNullLiteral } from './ts-utils';
import { ArrayRef, bot, NodeLattice, NodeLatticeElem, nodeLatticeFilter, nodeLatticeFlatMap, nodeLatticeMap, nullValue, stringValue } from './abstract-values';
import { AbstractResult, arrayResult, botResult, emptyMapResult, getArrayElement, getObjectProperty, join, joinAll, joinStores, literalResult, nodeLatticeJoinMap, nodeResult, nodesResult, objectResult, pretty, primopResult, promiseResult, resolvePromise, result, resultBind, resultBind2, setJoinMap, topResult } from './abstract-results';
import { isBareSpecifier } from './util';
import { FixedEval, FixedTrace, primopArray, primopDate, PrimopExpression, primopFecth, PrimopId, primopInternalCallSites, primopJSON, primopMath, primopObject, primops } from './primops';

export function makeDcfaComputer(service: ts.LanguageService): (node: ts.Node) => AbstractResult {
    const program = service.getProgram()!;
    const typeChecker = program.getTypeChecker();
    const printer = ts.createPrinter();

    const valueOf = makeFixpointComputer(botResult, {
        printArgs: printNode,
        printRet: result => pretty(result, printNode).toString() 
    });
    
    return function dcfa(node: ts.Node) {
    
        if (node === undefined) {
            throw new Error('no node at that position')
        }
        console.log(`dcfa for: ${printNode(node)}`)
    
        return valueOf({
            func: abstractEval,
            args: node,
        });
    
        // "eval"
        function abstractEval(node: ts.Node, fix_run: FixRunFunc<ts.Node, AbstractResult>): AbstractResult {
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
                const valuesOfFunctionBodies = nodeLatticeJoinMap(possibleFunctions, (func) => {
                    if (!isFunctionLikeDeclaration(func)) {
                        throw new Error(`Expected a function, got ${SyntaxKind[func.kind]}`)
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
                    applyPrimop(
                        node,
                        node => fix_run(abstractEval, node),
                        node => fix_run(getWhereValueReturned, node), 
                        primopId,
                        thisResult,
                        argumentValues
                    )
                );
    
                return join(valuesOfFunctionBodies, valuesOfPrimopExpresssions);
            } else if (ts.isIdentifier(node)) {
                const boundExprs = getBoundExprs(node, fix_run);
                return nodeLatticeJoinMap(boundExprs, boundExpr => fix_run(abstractEval, boundExpr));
            } else if (ts.isParenthesizedExpression(node)) {
                return fix_run(abstractEval, node.expression);
            } else if (ts.isBlock(node)) {
                const returnStatements = [...getReturnStmts(node)];
                const returnStatementValues = returnStatements.map(returnStatement => {
                    if (returnStatement.expression === undefined) {
                        return unimplementedRes('return statement should have expression');   
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
                    return unimplementedRes(`Expected simple identifier property access: ${node.name}`);
                }
    
                const expressionResult = fix_run(abstractEval, node.expression);
                const propertyAccessResult = getObjectProperty(expressionResult, node.name);
                if (propertyAccessResult !== botResult) {
                    return propertyAccessResult;
                }
    
                const primop = getPrimitivePrimop(expressionResult, node.name.text);
                if (primop === undefined) {
                    return unimplementedRes(`Property access must result in a non-bot value: ${printNode(node)} @ ${getPosText(node)}`);
                }

                return primopResult(primop)
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
            } else if (ts.isElementAccessExpression(node)) {
                const expressionResult = fix_run(abstractEval, node.expression);
                return getArrayElement(expressionResult);
            } else if (ts.isNewExpression(node)) {
                if (!(ts.isIdentifier(node.expression) && node.expression.text === 'Map')) {
                    return unimplementedRes(`New expression not yet implemented for ${printNode(node.expression)}`)
                }
    
                return emptyMapResult(node);
            } else if (isNullLiteral(node)) {
                return result(nullValue);
            } else if (ts.isBinaryExpression(node)) {
                const lhsRes = fix_run(abstractEval, node.left);
                const rhsRes = fix_run(abstractEval, node.right);
                const primopId = node.operatorToken.kind;
                return applyPrimop(
                    node,
                    node => fix_run(abstractEval, node),
                    node => fix_run(getWhereValueReturned, node), 
                    primopId,
                    botResult,
                    [lhsRes, rhsRes],
                )
            } else if (ts.isTemplateExpression(node)) {
                const components = [
                    fix_run(abstractEval, node.head),
                    ...node.templateSpans.flatMap(span => [
                        fix_run(abstractEval, span.expression),
                        fix_run(abstractEval, span.literal),
                    ]),
                ];
                return components.reduce(
                    (acc, curr) => resultBind2(acc, curr, 'strings',
                        (str1: string, str2) => result(stringValue(str1 + str2))
                    ),
                    result(stringValue(''))
                )
            } else if (ts.isConditionalExpression(node)) {
                const trueResult = fix_run(abstractEval, node.whenTrue);
                const falseResult = fix_run(abstractEval, node.whenFalse);
                return join(trueResult, falseResult)
            }
            return unimplementedRes(`abstractEval not yet implemented for: ${ts.SyntaxKind[node.kind]}:${getPosText(node)}`);
    
            function evalObject(node: ts.ObjectLiteralExpression): AbstractResult {
                const { object, stores } = node.properties.reduce((acc, curr) => {
                    if (curr.name === undefined || !ts.isIdentifier(curr.name)) {
                        return unimplemented(`expected identifier for property: ${SyntaxKind[curr.kind]}:${getPosText(curr)}`, acc)
                    }
    
                    let result: AbstractResult;
                    if (ts.isPropertyAssignment(curr)) {
                        result = fix_run(abstractEval, curr.initializer);
                    } else if (ts.isShorthandPropertyAssignment(curr)) {
                        result = fix_run(abstractEval, curr.name);
                    } else {
                        return unimplemented(`Unimplemented object property assignment: ${SyntaxKind[curr.kind]}:${getPosText(curr)}}`, acc)
                    }
                    acc.object[curr.name.text] = result.value;
                    acc.stores = joinStores(acc.stores, result);
                    return acc;
                }, { object: {}, stores: botResult });
    
                return objectResult(node, object, stores);
            }
    
            function evalArray(node: ts.ArrayLiteralExpression): AbstractResult {
                const itemValue = setJoinMap(new SimpleSet(structuralComparator, ...node.elements), (elem) => {
                    if (ts.isSpreadElement(elem)) {
                        const expressionResult = fix_run(abstractEval, elem.expression);
                        return resultBind(expressionResult, 'arrays', 
                            (arrRef: ArrayRef) => ({
                                ...expressionResult,
                                value: expressionResult.arrayStore.get(arrRef)!.element,
                            })
                        );
                    } else {
                        return fix_run(abstractEval, elem)
                    }
                });
    
                return arrayResult(node, itemValue);
            }
        }
        
        // "expr"
        function getWhereValueApplied(node: ts.Node, fix_run: FixRunFunc<Node, AbstractResult>): AbstractResult {
            const operatorSites = nodeLatticeFilter(
                getWhereValueReturned(node, fix_run).value.nodes,
                func => ts.isCallExpression(func.parent) && isOperatorOf(func, func.parent)
            );
            return nodesResult(
                nodeLatticeMap(operatorSites, op => op.parent)
            )
        }
        
        function getWhereObjectConstructed(node: ts.Node, fix_run: FixRunFunc<Node, AbstractResult>): AbstractResult {
            const valueReturnedAt = getWhereValueReturned(node, fix_run).value.nodes;
            const objectConstructors = nodeLatticeFilter(valueReturnedAt, ts.isObjectLiteralExpression);
            
            return nodesResult(objectConstructors);
        }
        
        function getWhereArrayConstructed(node: ts.Node, fix_run: FixRunFunc<Node, AbstractResult>): AbstractResult {
            const valueReturnedAt = getWhereValueReturned(node, fix_run).value.nodes;
            const objectConstructors = nodeLatticeFilter(valueReturnedAt, ts.isArrayLiteralExpression);
            
            return nodesResult(objectConstructors);
        }
    
        function getWhereValueReturned(node: ts.Node, fix_run: FixRunFunc<Node, AbstractResult>): AbstractResult {
            return join(nodeResult(node), getWhereValueReturnedElsewhere(node, fix_run));
        }
    
        function getWhereValueReturnedElsewhere(node: ts.Node, fix_run: FixRunFunc<Node, AbstractResult>): AbstractResult {
            const parent = node.parent;
            if (ts.isCallExpression(parent)) {
                if (isOperatorOf(node, parent)) {
                    return botResult; // If we're the operator, our value doesn't get propogated anywhere
                } else {
                    const argIndex = getArgumentIndex(parent, node);
                    const possibleOperators = fix_run(
                        abstractEval, parent.expression
                    ).value;
    
                    const possibleFunctions = possibleOperators.nodes;
                    const parameterReferences = nodeLatticeJoinMap(
                        possibleFunctions,
                        (func) => {
                            const parameterName = (func as SimpleFunctionLikeDeclaration).parameters[argIndex].name;
                            return ts.isIdentifier(parameterName) 
                                ? nodesResult(getReferences(parameterName))
                                : botResult; // If it's not an identifier, it's being destructured, so the value doesn't continue on
                        }
                    ).value.nodes;
                    const functionResult = nodeLatticeJoinMap(parameterReferences, (parameterRef) => fix_run(getWhereValueReturned, parameterRef));
    
                    const possiblePrimopIds = possibleOperators.primops;
                    const possiblePrimopCallsiteConstructors = setMap(possiblePrimopIds, (id =>
                        primopInternalCallSites[id]
                    ));
                    const thisNode = ts.isPropertyAccessExpression(parent.expression)
                        ? parent.expression.expression
                        : undefined;
                    const primopResult = setJoinMap(possiblePrimopCallsiteConstructors, (construct =>
                        nodesResult(construct.apply(thisNode, [[...parent.arguments], argIndex]))
                    ));
    
                    return join(functionResult, primopResult);
                }
            } else if (isFunctionLikeDeclaration(parent)) {
                const closedOverSites = fix_run(getWhereClosed, node).value.nodes;
                return nodeLatticeJoinMap(closedOverSites, site => fix_run(getWhereValueReturned, site));
            } else if (ts.isParenthesizedExpression(parent)) {
                return fix_run(getWhereValueReturned, parent);
            } else if (ts.isVariableDeclaration(parent)) {
                if (!ts.isIdentifier(parent.name)) {
                    return botResult; // if it's not an identifier, we're destructuring it, which will return different values
                }
    
                const refs = getReferences(parent.name)
                return nodeLatticeJoinMap(refs, ref => fix_run(getWhereValueReturned, ref));
            } else if (ts.isFunctionDeclaration(node)) { // note that this is a little weird since we're not looking at the parent
                if (node.name === undefined) {
                    return unimplementedRes('function declaration should have name')
                }
    
                const refs = getReferences(node.name);
                return nodeLatticeJoinMap(refs, ref => fix_run(getWhereValueReturned, ref));
            } else if (ts.isForOfStatement(parent) && parent.expression === node) {
                return botResult; // we're effectively "destructuring" the expression here, so the original value is gone
            }
            return unimplementedRes(`Unknown kind for getWhereValueReturned: ${SyntaxKind[parent.kind]}:${getPosText(parent)}`);
        }
        
        // "call"
        function getWhereClosed(node: ts.Node, fix_run: FixRunFunc<ts.Node, AbstractResult>): AbstractResult {
            if (!isFunctionLikeDeclaration(node.parent)) {
                return unimplementedRes(`Trying to find closure locations for ${SyntaxKind[node.kind]}`);
            }
    
            return fix_run(getWhereValueApplied, node.parent)
        }
        
        // "find"
        function getReferences(id: ts.Identifier): NodeLattice {
            const refs = service
                .findReferences(id.getSourceFile().fileName, id.getStart())
                ?.flatMap(ref => ref.references)
                ?.filter(ref => !ref.isDefinition);
            if (refs === undefined) {
                return unimplemented('undefined references', empty());
            }
            const refNodes = refs.map(ref => getNodeAtPosition(
                program.getSourceFile(ref.fileName)!,
                ref.textSpan?.start!
            )!);
            return new SimpleSet<NodeLatticeElem>(structuralComparator, ...refNodes);
        }
        
        // bind
        function getBoundExprs(id: ts.Identifier, fix_run: FixRunFunc<ts.Node, AbstractResult>): NodeLattice {
            const symbol = typeChecker.getSymbolAtLocation(id);
            if (symbol === undefined) {
                return unimplemented('Unable to find symbol', empty())
            }
    
            return getBoundExprsOfSymbol(symbol, fix_run);
        }

        function getBoundExprsOfSymbol(symbol: ts.Symbol, fix_run: FixRunFunc<ts.Node, AbstractResult>): NodeLattice {
            const declaration = symbol.valueDeclaration
                ?? symbol?.declarations?.[0]; // it seems like this happens when the declaration is an import clause
            if (declaration === undefined) {
                return unimplemented(`could not find declaration: ${symbol.name}`, empty());
            }

            if (ts.isParameter(declaration)) {
                return getArgumentsForParameter(declaration)
            } else if (ts.isVariableDeclaration(declaration)) {
                if (ts.isForOfStatement(declaration.parent.parent)) {
                    const forOfStatement = declaration.parent.parent;
                    const expression = forOfStatement.expression;
    
                    const arrayLiterals = fix_run(getWhereArrayConstructed, expression)
                        .value.nodes;
    
                    // dummy element access
                    return nodeLatticeFlatMap(arrayLiterals, arrLit => {
                        const elements = (arrLit as ArrayLiteralExpression).elements;
                        return joinAll(...elements.map(elem => fix_run(abstractEval, elem))).value.nodes;
                    });
                } else { // assuming it's a standard variable delcaration
                    if (declaration.initializer === undefined) {
                        return unimplemented(`Variable declaration should have initializer: ${SyntaxKind[declaration.kind]}:${getPosText(declaration)}`, empty())
                    }
        
                    return singleton<NodeLatticeElem>(declaration.initializer);
                }
            } else if (ts.isFunctionDeclaration(declaration)) {
                return singleton<NodeLatticeElem>(declaration);
            } else if (ts.isBindingElement(declaration)) {
                const bindingElementSource = declaration.parent.parent;
                if (ts.isVariableDeclaration(bindingElementSource)) {
                    const initializer = bindingElementSource.initializer;
                    if (initializer === undefined) {
                        return unimplemented(`Variable declaration should have initializer: ${SyntaxKind[declaration.kind]}:${getPosText(declaration)}`, empty())
                    }
    
                    const objectConstructors = fix_run(getWhereObjectConstructed, initializer)
                        .value.nodes;
                    return getObjectsPropertyInitializers(objectConstructors, symbol.name);
                } else if (ts.isParameter(bindingElementSource)) {
                    const args = getArgumentsForParameter(bindingElementSource);
    
                    const objectConstructors = nodeLatticeFlatMap(args, arg =>
                        fix_run(getWhereObjectConstructed, arg)
                            .value.nodes
                    );
                    return getObjectsPropertyInitializers(objectConstructors, symbol.name);
                }
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
                    return singleton<NodeLatticeElem>(declaration);
                }

                const aliasedSymbol = typeChecker.getAliasedSymbol(symbol);
                const trueDeclaration = aliasedSymbol.valueDeclaration ?? aliasedSymbol.declarations?.[0];
                if (trueDeclaration === undefined) {
                    return unimplemented('unable to follow import statement through', empty());
                }

                return singleton<NodeLatticeElem>(trueDeclaration);
            } else if (ts.isShorthandPropertyAssignment(declaration)) {
                const shorthandValueSymbol = typeChecker.getShorthandAssignmentValueSymbol(declaration);
                if (shorthandValueSymbol === undefined) {
                    throw new Error(`Should have gotten value symbol for shortand assignment: ${symbol.name} @ ${getPosText(declaration)}`)
                }
                return getBoundExprsOfSymbol(shorthandValueSymbol, fix_run);
            }
            return unimplemented(`getBoundExprs not yet implemented for ${ts.SyntaxKind[declaration.kind]}:${getPosText(declaration)}`, empty());
    
            function getArgumentsForParameter(declaration: ParameterDeclaration): NodeLattice {
                if (!isFunctionLikeDeclaration(declaration.parent)) {
                    return unimplemented('not yet implemented', empty());
                }
                const parameterIndex = declaration.parent.parameters.indexOf(declaration);
                const definingFunctionBody = declaration.parent.body
        
                const definingFunctionCallSites = fix_run(
                    getWhereClosed, definingFunctionBody
                ).value.nodes;
                return setMap(definingFunctionCallSites, (callSite) => {
                    return (callSite as CallExpression).arguments[parameterIndex] as Node;
                }) as NodeLattice;
            }
        }
    
        function getObjectsPropertyInitializers(objConstructors: NodeLattice, idName: string): NodeLattice {
            return nodeLatticeFlatMap(objConstructors, objConstructor => {
                const initializer = getObjectPropertyInitializer(objConstructor as ObjectLiteralExpression, idName);
                
                return initializer !== undefined
                    ? singleton<NodeLatticeElem>(initializer)
                    : empty<NodeLatticeElem>();
            });
        }
    }
    
    function printNode(node: ts.Node) {
        const sf = ts.createSourceFile('temp.ts', '', ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
        return printer.printNode(ts.EmitHint.Unspecified, node, sf);
    }

    function getPosText(node: ts.Node) {
        const { line, character } = ts.getLineAndCharacterOfPosition(program.getSourceFiles()[0], node.pos);
        return line + ':' + character
    }
}
    
function getObjectPropertyInitializer(objConstructor: ObjectLiteralExpression, idName: string): ts.Node | undefined {
    const reversedProps = [...objConstructor.properties].reverse();

    function getPropertyAssignmentInitializer() {
        const propAssignment = reversedProps.find(prop =>
            ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === idName
        ) as PropertyAssignment;

        return propAssignment?.initializer;
    }

    function getShorthandPropertyAssignmentInitializer() {
        const shorthandPropAssignment = reversedProps.find(prop =>
            ts.isShorthandPropertyAssignment(prop) && prop.name.text === idName
        ) as ShorthandPropertyAssignment;

        return shorthandPropAssignment.name;
    }

    return getPropertyAssignmentInitializer()
        ?? getShorthandPropertyAssignmentInitializer();
}
        
function isOperatorOf(op: ts.Node, call: ts.CallExpression) {
    return op === call.expression;
}

function getArgumentIndex(call: ts.CallExpression, arg: ts.Node) {
    return call.arguments.indexOf(arg as Expression);
}

function getOverriddenResult(node: ts.Node): false | AbstractResult {
    // in the long run, probably need a better way than just checking ids, since ids are used all over the place
    if (ts.isIdentifier(node)) {
        if (node.text === 'Math') {
            return primopMath;
        } else if (node.text === 'fetch') {
            return primopFecth;
        } else if (node.text === 'JSON') {
            return primopJSON;
        } else if (node.text === 'Date') {
            return primopDate;
        } else if (node.text === 'Object') {
            return primopObject;
        } else if (node.text === 'Array') {
            return primopArray;
        }
    }

    return false;
}

function applyPrimop<Arg, Ret>(expression: PrimopExpression, fixed_eval: FixedEval, fixed_trace: FixedTrace, primopId: PrimopId, thisRes: AbstractResult, args: AbstractResult[]): AbstractResult {
    return primops[primopId].apply(thisRes, [expression, fixed_eval, fixed_trace, ...args]);
}

function getPrimitivePrimop(res: AbstractResult, name: string): PrimopId | undefined {
    const primopIds = Object.keys(primops);

    if (res.value.strings !== bot) {
        const stringPrimops = primopIds.filter(id => id.split('#')[0] === 'String');
        return stringPrimops.find(id => id.split('#')[1] === name) as PrimopId ?? false;
    } else if (res.value.arrays !== bot) {
        const arrayPrimops = primopIds.filter(id => id.split('#')[0] === 'Array');
        return arrayPrimops.find(id => id.split('#')[1] === name) as PrimopId ?? false;
    } else if (res.value.maps !== bot) {
        const mapPrimops = primopIds.filter(id => id.split('#')[0] === 'Map');
        return mapPrimops.find(id => id.split('#')[1] === name) as PrimopId ?? false;
    }

    return undefined;
}

function unimplemented<T>(message: string, returnVal: T): T {
    console.warn(message);
    return returnVal;
}

function unimplementedRes(message: string): AbstractResult {
    return unimplemented(message, botResult);
}
