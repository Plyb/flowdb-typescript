import ts, { CallExpression, Expression, Node, SyntaxKind, ParameterDeclaration, ObjectLiteralExpression, PropertyAssignment, ShorthandPropertyAssignment, ArrayLiteralExpression } from 'typescript';
import { SimpleSet } from 'typescript-super-set';
import { empty, setFlatMap, setMap, singleton, union } from './setUtil';
import { FixRunFunc, makeFixpointComputer } from './fixpoint';
import { structuralComparator } from './comparators';
import { getNodeAtPosition, getReturnStmts, isFunctionLikeDeclaration, isLiteral as isAtomicLiteral, SimpleFunctionLikeDeclaration, isAsync, isNullLiteral } from './ts-utils';
import { ArrayRef, bot, isTop, NodeLattice, NodeLatticeElem, nodeLatticeFilter, nodeLatticeFlatMap, nodeLatticeMap, nodeValue, nullValue, ObjectRef, stringValue, undefinedValue } from './abstract-values';
import { AbstractResult, arrayResult, botResult, emptyMapResult, getArrayElement, getObjectProperty, join, joinAll, joinStores, literalResult, nodeLatticeJoinMap, nodeResult, nodesResult, objectResult, pretty, primopResult, promiseResult, resolvePromise, result, resultBind, resultBind2, setJoinMap, topResult } from './abstract-results';
import { getElementNodesOfArrayValuedNode, isBareSpecifier, unimplemented, unimplementedRes } from './util';
import { FixedEval, FixedTrace, primopArray, primopBinderGetters, primopDate, PrimopApplication, primopFecth, PrimopId, primopJSON, primopMath, primopObject, primops } from './primops';
import { getPrimops } from './value-constructors';

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
        console.info(`dcfa for: ${printNode(node)}`)
    
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
                const possibleOperators = fix_run(abstractEval, operator).value.nodes;
    
                // const possibleFunctions = possibleOperators.nodes;
                return nodeLatticeJoinMap(possibleOperators, (op) => {
                    if (isFunctionLikeDeclaration(op)) {
                        const body: ts.Node = op.body;
                        const result = fix_run(abstractEval, body);
                        if (isAsync(op)) {
                            return promiseResult(op, result);
                        } else {
                            return result;
                        }
                    } else if (ts.isPropertyAccessExpression(op)) {
                        const primops = getPrimops(op, node => fix_run(abstractEval, node), printNode); // TODO: fixed_eval and printNodeAndPos
                        if (primops.size() === 0) {
                            return unimplementedRes(`No primops found for a property access constructor ${op}`);
                        }
                        // In the case of calling a built in function, the call-site *is* the constructor site
                        return nodeResult(node);
                    } else if (ts.isIdentifier(op)) {
                        // verify that the id is a primop
                        if (primops[op.text] === undefined) {
                            return unimplementedRes(`Expected ${op.text} to be a primop @ ${getPosText(op)}`);
                        }

                        return nodeResult(node);
                    } else {
                        return unimplementedRes(`Unknown kind of operator: ${printNode(op)} @ ${getPosText(op)}`);
                    }
                });
            } else if (ts.isIdentifier(node) && node.text == 'undefined') { // `undefined` is represented in the AST just as a special identifier, so we need to check for this before we look for other identifiers
                return result(undefinedValue);
            } else if (ts.isIdentifier(node)) {
                const boundExprs = getBoundExprs(node, fix_run);
                return nodeLatticeJoinMap(boundExprs, boundExpr => fix_run(abstractEval, boundExpr));
            } else if (ts.isParenthesizedExpression(node)) {
                return fix_run(abstractEval, node.expression);
            } else if (ts.isBlock(node)) {
                const returnStatements = [...getReturnStmts(node)];
                const returnStatementValues = returnStatements.map(returnStatement => {
                    if (returnStatement.expression === undefined) {
                        return botResult;
                    }
                    return fix_run(abstractEval, returnStatement.expression);
                });
                return joinAll(...returnStatementValues);
            } else if (isAtomicLiteral(node)) {
                return literalResult(node);
            } else if (ts.isObjectLiteralExpression(node)) {
                return nodeResult(node);
            } else if (ts.isPropertyAccessExpression(node)) {
                if (!ts.isIdentifier(node.name)) {
                    return unimplementedRes(`Expected simple identifier property access: ${node.name}`);
                }
    
                const expressionResult = fix_run(abstractEval, node.expression);
                const propertyAccessResult = getObjectProperty(expressionResult, node.name, node => fix_run(abstractEval, node));
                if (propertyAccessResult !== botResult) {
                    return propertyAccessResult;
                }
    
                const primops = getPrimops(node, node => fix_run(abstractEval, node), printNode);
                if (primops.size() === 0) {
                    return unimplementedRes(`Property access must result in a non-bot value: ${printNode(node)} @ ${getPosText(node)}`);
                }

                // a property access that results in a built in method is itself a constructor
                return nodeResult(node);
            } else if (ts.isAwaitExpression(node)) {
                const expressionValue = fix_run(abstractEval, node.expression);
                return resolvePromise(expressionValue);
            } else if (ts.isArrayLiteralExpression(node)) {
                return nodeResult(node);
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
                return nodeResult(node);
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
                const itemValue = setJoinMap(new SimpleSet(structuralComparator, ...node.elements), (elem) => 
                    evalArrayElement(elem, fix_run)
                );
    
                return arrayResult(node, itemValue);
            }
        }

        function evalArrayElement(elem: ts.Node, fix_run: FixRunFunc<Node, AbstractResult>): AbstractResult {
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
    
        function getWhereValueReturned(node: ts.Node, fix_run: FixRunFunc<Node, AbstractResult>): AbstractResult {
            return join(nodeResult(node), getWhereValueReturnedElsewhere(node, fix_run));
        }
    
        function getWhereValueReturnedElsewhere(node: ts.Node, fix_run: FixRunFunc<Node, AbstractResult>): AbstractResult {
            const parent = node.parent;
            if (ts.isCallExpression(parent)) {
                if (isOperatorOf(node, parent)) {
                    return botResult; // If we're the operator, our value doesn't get propogated anywhere
                } else {
                    return getWhereReturnedInsideFunction(parent, node, (parameterName) =>
                        ts.isIdentifier(parameterName) 
                            ? getReferences(parameterName)
                            : empty<NodeLatticeElem>() // If it's not an identifier, it's being destructured, so the value doesn't continue on
                    );
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
            } else if (ts.isPropertyAccessExpression(parent)) {
                if (node != parent.expression) {
                    return unimplementedRes(`Unknown situation for getWhereValueReturned: where to trace a child of propertyAccessExpression that isn't the expression for ${printNode(node)} @ ${getPosText(node)} `)
                }

                return botResult;
            } else if (ts.isShorthandPropertyAssignment(parent)) {
                const parentObjectReturnedAt = fix_run(getWhereValueReturned, parent.parent).value.nodes;
                return nodeLatticeJoinMap(parentObjectReturnedAt, returnLoc => {
                    const returnLocParent = returnLoc.parent;
                    if (ts.isCallExpression(returnLocParent) && !isOperatorOf(returnLoc, returnLocParent)) {
                        return getWhereReturnedInsideFunction(returnLocParent, returnLoc, (parameterName) => {
                            if (!ts.isObjectBindingPattern(parameterName)) {
                                return empty();
                            }
                            const destructedName = parameterName.elements.find(elem => 
                                ts.isIdentifier(elem.name)
                                    ? elem.name.text === parent.name.text
                                    : unimplemented(`Nested binding patterns unimplemented: ${printNode(elem)} @ ${getPosText(elem)}`, empty())
                            )?.name;
                            if (destructedName === undefined) {
                                return unimplemented(`Unable to find destructed identifier in ${printNode(parameterName)} @ ${getPosText(parameterName)}`, empty())
                            }
                            if (!ts.isIdentifier(destructedName)) {
                                return unimplemented(`Expected a simple binding name ${printNode(destructedName)} @ ${getPosText(destructedName)}`, empty())
                            }

                            return getReferences(destructedName);
                        })
                    }
                    return unimplementedRes(`Unknown result for obtaining ${parent.name.text} from object at ${printNode(returnLocParent)} @ ${getPosText(returnLocParent)}`);
                })
            }
            return unimplementedRes(`Unknown kind for getWhereValueReturned: ${SyntaxKind[parent.kind]}:${getPosText(parent)}`);

            function getWhereReturnedInsideFunction(parent: ts.CallExpression, node: ts.Node, getReferencesFromParameter: (name: ts.BindingName) => NodeLattice) {
                const argIndex = getArgumentIndex(parent, node);
                const possibleOperators = fix_run(
                    abstractEval, parent.expression
                ).value;

                const possibleFunctions = possibleOperators.nodes;
                const parameterReferences = nodeLatticeJoinMap(
                    possibleFunctions,
                    (func) => {
                        const parameterName = (func as SimpleFunctionLikeDeclaration).parameters[argIndex].name;
                        const refs = getReferencesFromParameter(parameterName);
                        return nodeLatticeJoinMap(refs, ref => fix_run(getWhereValueReturned, ref));
                    }
                ).value.nodes;
                return nodeLatticeJoinMap(parameterReferences, (parameterRef) => fix_run(getWhereValueReturned, parameterRef));
            }
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
                return unimplemented(`Unable to find symbol ${id.text}`, empty())
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
                return getArgumentsForParameter(declaration);
            } else if (ts.isVariableDeclaration(declaration)) {
                if (ts.isForOfStatement(declaration.parent.parent)) {
                    const forOfStatement = declaration.parent.parent;
                    const expression = forOfStatement.expression;
    
                    return getElementNodesOfArrayValuedNode(expression, node => fix_run(abstractEval, node));
                } else { // it's a standard variable delcaration
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
    
                    const initializerResult = fix_run(abstractEval, initializer);
                    const objectLiterals = resultBind<ObjectRef>(initializerResult, 'objects', objRef => nodeResult(objRef))
                        .value.nodes;

                    return getObjectsPropertyInitializers(objectLiterals, symbol.name);
                } else if (ts.isParameter(bindingElementSource)) {
                    const args = getArgumentsForParameter(bindingElementSource);
                    
                    const argsResults = nodeLatticeJoinMap(args, arg => fix_run(abstractEval, arg));
                    const objectConstructors = resultBind<ObjectRef>(argsResults, 'objects', objRef => nodeResult(objRef))
                        .value.nodes;

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
                const declaringFunction = declaration.parent;
                if (!isFunctionLikeDeclaration(declaringFunction)) {
                    return unimplemented('not yet implemented', empty());
                }
                const parameterIndex = declaringFunction.parameters.indexOf(declaration);
                const definingFunctionBody = declaringFunction.body
        
                const definingFunctionCallSites = fix_run(
                    getWhereClosed, definingFunctionBody
                ).value.nodes;
                const boundFromArgs =  setMap(definingFunctionCallSites, (callSite) => {
                    return (callSite as CallExpression).arguments[parameterIndex] as Node;
                }) as NodeLattice;

                const sitesWhereDeclaringFunctionReturned = fix_run(getWhereValueReturned, declaringFunction).value.nodes;
                const boundFromPrimop = nodeLatticeFlatMap(
                    sitesWhereDeclaringFunctionReturned,
                    (node) => {
                        const callSite = node.parent;
                        if (!ts.isCallExpression(callSite)) {
                            return empty<NodeLatticeElem>();
                        }
                        const primopsNodes = fix_run(abstractEval, callSite.expression).value.nodes;
                        const primops = setFlatMap(primopsNodes, primopNode => {
                            if (isTop(primopNode)) {
                                return empty<PrimopId>(); // TODO: this should be all primops
                            }
                            if (!ts.isPropertyAccessExpression(primopNode)) {
                                return empty<PrimopId>();
                            }
                            return getPrimops(primopNode, node => fix_run(abstractEval, node), printNode);
                        });

                        return setFlatMap(primops, (primop) => {
                            const binderGetter = primopBinderGetters[primop];
                            const argParameterIndex = declaration.parent.parameters.indexOf(declaration);
                            const primopArgIndex = callSite.arguments.indexOf(node as Expression);
                            const thisExpression = ts.isPropertyAccessExpression(callSite.expression)
                                ? callSite.expression.expression
                                : undefined;
                            return binderGetter.apply(thisExpression, [primopArgIndex, argParameterIndex, (node) => fix_run(abstractEval, node)]);
                        }) as NodeLattice;
                    }
                );

                return union(boundFromArgs, boundFromPrimop);
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
            return nodeResult(node);
        } else if (node.text === 'JSON') {
            return primopJSON;
        } else if (node.text === 'Date') {
            return nodeResult(node);
        } else if (node.text === 'Object') {
            return primopObject;
        } else if (node.text === 'Array') {
            return primopArray;
        }
    }

    return false;
}

function applyPrimop<Arg, Ret>(expression: PrimopApplication, fixed_eval: FixedEval, fixed_trace: FixedTrace, primopId: PrimopId, thisRes: AbstractResult, args: AbstractResult[]): AbstractResult {
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
    } else if (res.value.regexps !== bot) {
        const regexpPrimops = primopIds.filter(id => id.split('#')[0] === 'RegExp');
        return regexpPrimops.find(id => id.split('#')[1] === name) as PrimopId ?? false;
    }

    return undefined;
}
