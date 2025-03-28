import ts, { CallExpression, Expression, Node, SyntaxKind, ParameterDeclaration, ObjectLiteralExpression, PropertyAssignment } from 'typescript';
import { SimpleSet } from 'typescript-super-set';
import { empty, setFilter, setFlatMap, setMap, singleton, union } from './setUtil';
import { FixRunFunc, makeFixpointComputer } from './fixpoint';
import { structuralComparator } from './comparators';
import { getNodeAtPosition, getReturnStmts, isFunctionLikeDeclaration, isLiteral as isAtomicLiteral, SimpleFunctionLikeDeclaration, isAsync, isNullLiteral, isAsyncKeyword, Ambient } from './ts-utils';
import { AbstractValue, botValue, getElementNodesOfArrayValuedNode, getObjectProperty, isTop, joinAllValues, joinValue, NodeLattice, NodeLatticeElem, nodeLatticeFilter, nodeLatticeFlatMap, nodeLatticeJoinMap, nodeLatticeMap, nodeValue, pretty, topValue } from './abstract-values';
import { isBareSpecifier, unimplemented, unimplementedVal } from './util';
import { primopBinderGetters } from './primops';
import { getBuiltInValueOfBuiltInConstructor, idIsBuiltIn, isBuiltInConstructorShaped, resultOfCalling } from './value-constructors';

export function makeDcfaComputer(service: ts.LanguageService): (node: ts.Node) => AbstractValue {
    const program = service.getProgram()!;
    const typeChecker = program.getTypeChecker();
    const printer = ts.createPrinter();

    const valueOf = makeFixpointComputer(botValue, {
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
        function abstractEval(node: ts.Node, fix_run: FixRunFunc<ts.Node, AbstractValue>): AbstractValue {    
            if (isFunctionLikeDeclaration(node)) {
                return nodeValue(node);
            } else if (ts.isCallExpression(node)) {
                const operator: ts.Node = node.expression;
                const possibleOperators = fix_run(abstractEval, operator);

                return nodeLatticeJoinMap(possibleOperators, (op) => {
                    if (isFunctionLikeDeclaration(op)) {
                        if (isAsync(op)) {
                            return nodeValue(op.modifiers[0])
                        } else {
                            const body: ts.Node = op.body;
                            const result = fix_run(abstractEval, body);
                            return result;
                        }
                    } else if (isBuiltInConstructorShaped(op)) {
                        const builtInValue = getBuiltInValueOfBuiltInConstructor(op, node => fix_run(abstractEval, node), printNode);
                        return resultOfCalling[builtInValue](node, { fixed_eval: node => fix_run(abstractEval, node) });
                    } else {
                        return unimplementedVal(`Unknown kind of operator: ${printNode(op)} @ ${getPosText(op)}`);
                    }
                });
            } else if (ts.isIdentifier(node) && node.text == 'undefined') { // `undefined` is represented in the AST just as a special identifier, so we need to check for this before we look for other identifiers
                // TODO: I think we can treat this like a built in
                return nodeValue(node);
            } else if (ts.isIdentifier(node)) {
                const boundExprs = getBoundExprs(node, fix_run);
                if (boundExprs.size() > 0) {
                    return nodeLatticeJoinMap(boundExprs, boundExpr => fix_run(abstractEval, boundExpr));
                } else if (idIsBuiltIn(node)) {
                    return nodeValue(node);
                } else {
                    return unimplementedVal(`Could not find binding for ${printNode(node)} @ ${getPosText(node)}`)
                }
            } else if (ts.isParenthesizedExpression(node)) {
                return fix_run(abstractEval, node.expression);
            } else if (ts.isBlock(node)) {
                const returnStatements = [...getReturnStmts(node)];
                const returnStatementValues = returnStatements.map(returnStatement => {
                    if (returnStatement.expression === undefined) {
                        return botValue;
                    }
                    return fix_run(abstractEval, returnStatement.expression);
                });
                return joinAllValues(...returnStatementValues);
            } else if (isAtomicLiteral(node)) {
                return nodeValue(node);
            } else if (ts.isObjectLiteralExpression(node)) {
                return nodeValue(node);
            } else if (ts.isPropertyAccessExpression(node)) {
                if (!ts.isIdentifier(node.name)) {
                    return unimplementedVal(`Expected simple identifier property access: ${node.name}`);
                }
    
                return getObjectProperty(node, node => fix_run(abstractEval, node), printNode);
            } else if (ts.isAwaitExpression(node)) {
                const expressionValue = fix_run(abstractEval, node.expression);
                return nodeLatticeJoinMap(expressionValue, cons => {
                    if (isAsyncKeyword(cons)) {
                        const sourceFunction = cons.parent;
                        if (!isFunctionLikeDeclaration(sourceFunction)) {
                            return unimplementedVal(`Expected ${printNode(sourceFunction)} @ ${getPosText(sourceFunction)} to be the source of a promise value`);
                        }
                        return fix_run(abstractEval, sourceFunction.body);
                    } else {
                        return nodeValue(cons);
                    }
                })
            } else if (ts.isArrayLiteralExpression(node)) {
                return nodeValue(node);
            } else if (ts.isImportClause(node) || ts.isImportSpecifier(node)) {
                /**
                 * I believe we should only get here if we're trying to eval something that
                 * depends on an imported package that uses a bare specifier (or the client
                 * has directly requested the value of an import statement). In that case,
                 * for simplicity's sake for now, we're just going to say it could be anything.
                 */
                return topValue;
            } else if (ts.isElementAccessExpression(node)) {
                const elementExpressions = getElementNodesOfArrayValuedNode(node, { fixed_eval: node => fix_run(abstractEval, node), fixed_trace: node => fix_run(getWhereValueReturned, node), printNodeAndPos: printNode });
                const elementResults = nodeLatticeJoinMap(elementExpressions, element => fix_run(abstractEval, element));
                return elementResults;
            } else if (ts.isNewExpression(node)) {
                return nodeValue(node);
            } else if (isNullLiteral(node)) {
                return nodeValue(node);
            } else if (ts.isBinaryExpression(node)) {
                const lhsRes = fix_run(abstractEval, node.left);
                const rhsRes = fix_run(abstractEval, node.right);
                const primopId = node.operatorToken.kind;
                if (primopId === SyntaxKind.BarBarToken || primopId === SyntaxKind.QuestionQuestionToken) {
                    return joinValue(lhsRes, rhsRes);
                } else {
                    return unimplementedVal(`Unimplemented binary expression ${printNode(node)} @ ${getPosText(node)}`);
                }
            } else if (ts.isTemplateExpression(node)) {
                return nodeValue(node);
            } else if (ts.isConditionalExpression(node)) {
                const trueResult = fix_run(abstractEval, node.whenTrue);
                const falseResult = fix_run(abstractEval, node.whenFalse);
                return joinValue(trueResult, falseResult)
            }
            return unimplementedVal(`abstractEval not yet implemented for: ${ts.SyntaxKind[node.kind]}:${getPosText(node)}`);
        }
        
        // "expr"
        function getWhereValueApplied(node: ts.Node, fix_run: FixRunFunc<Node, AbstractValue>): AbstractValue {
            const operatorSites = nodeLatticeFilter(
                getWhereValueReturned(node, fix_run),
                func => ts.isCallExpression(func.parent) && isOperatorOf(func, func.parent)
            );
            return nodeLatticeMap(operatorSites, op => op.parent);
        }
    
        function getWhereValueReturned(node: ts.Node, fix_run: FixRunFunc<Node, AbstractValue>): AbstractValue {
            return joinValue(nodeValue(node), getWhereValueReturnedElsewhere(node, fix_run));
        }
    
        function getWhereValueReturnedElsewhere(node: ts.Node, fix_run: FixRunFunc<Node, AbstractValue>): AbstractValue {
            const parent = node.parent;
            if (ts.isCallExpression(parent)) {
                if (isOperatorOf(node, parent)) {
                    return botValue; // If we're the operator, our value doesn't get propogated anywhere
                } else {
                    return getWhereReturnedInsideFunction(parent, node, (parameterName) =>
                        ts.isIdentifier(parameterName) 
                            ? getReferences(parameterName)
                            : empty<NodeLatticeElem>() // If it's not an identifier, it's being destructured, so the value doesn't continue on
                    );
                }
            } else if (isFunctionLikeDeclaration(parent)) {
                const closedOverSites = fix_run(getWhereClosed, node);
                return nodeLatticeJoinMap(closedOverSites, site => fix_run(getWhereValueReturned, site));
            } else if (ts.isParenthesizedExpression(parent)) {
                return fix_run(getWhereValueReturned, parent);
            } else if (ts.isVariableDeclaration(parent)) {
                if (!ts.isIdentifier(parent.name)) {
                    return botValue; // if it's not an identifier, we're destructuring it, which will return different values
                }
    
                const refs = getReferences(parent.name)
                return nodeLatticeJoinMap(refs, ref => fix_run(getWhereValueReturned, ref));
            } else if (ts.isFunctionDeclaration(node)) { // note that this is a little weird since we're not looking at the parent
                if (node.name === undefined) {
                    return unimplementedVal('function declaration should have name')
                }
    
                const refs = getReferences(node.name);
                return nodeLatticeJoinMap(refs, ref => fix_run(getWhereValueReturned, ref));
            } else if (ts.isForOfStatement(parent) && parent.expression === node) {
                return botValue; // we're effectively "destructuring" the expression here, so the original value is gone
            } else if (ts.isPropertyAccessExpression(parent)) {
                if (node != parent.expression) {
                    return unimplementedVal(`Unknown situation for getWhereValueReturned: where to trace a child of propertyAccessExpression that isn't the expression for ${printNode(node)} @ ${getPosText(node)} `)
                }

                return botValue;
            } else if (ts.isShorthandPropertyAssignment(parent)) {
                const parentObjectReturnedAt = fix_run(getWhereValueReturned, parent.parent);
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
                    return unimplementedVal(`Unknown result for obtaining ${parent.name.text} from object at ${printNode(returnLocParent)} @ ${getPosText(returnLocParent)}`);
                })
            }
            return unimplementedVal(`Unknown kind for getWhereValueReturned: ${SyntaxKind[parent.kind]}:${getPosText(parent)}`);

            function getWhereReturnedInsideFunction(parent: ts.CallExpression, node: ts.Node, getReferencesFromParameter: (name: ts.BindingName) => NodeLattice) {
                const argIndex = getArgumentIndex(parent, node);
                const possibleOperators = fix_run(
                    abstractEval, parent.expression
                );

                const possibleFunctions = nodeLatticeFilter(possibleOperators, isFunctionLikeDeclaration);
                const parameterReferences = nodeLatticeJoinMap(
                    possibleFunctions,
                    (func) => {
                        const parameterName = (func as SimpleFunctionLikeDeclaration).parameters[argIndex].name;
                        const refs = getReferencesFromParameter(parameterName);
                        return nodeLatticeJoinMap(refs, ref => fix_run(getWhereValueReturned, ref));
                    }
                );
                return nodeLatticeJoinMap(parameterReferences, (parameterRef) => fix_run(getWhereValueReturned, parameterRef));
            }
        }
        
        // "call"
        function getWhereClosed(node: ts.Node, fix_run: FixRunFunc<ts.Node, AbstractValue>): AbstractValue {
            if (!isFunctionLikeDeclaration(node.parent)) {
                return unimplementedVal(`Trying to find closure locations for ${SyntaxKind[node.kind]}`);
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
        function getBoundExprs(id: ts.Identifier, fix_run: FixRunFunc<ts.Node, AbstractValue>): NodeLattice {
            const symbol = typeChecker.getSymbolAtLocation(id);
            if (symbol === undefined) {
                return unimplemented(`Unable to find symbol ${id.text}`, empty())
            }

            if ((symbol.valueDeclaration?.flags ?? 0) & Ambient) { // it seems like this happens with built in ids like `Date`
                if (!idIsBuiltIn(id)) {
                    return unimplemented(`Expected ${printNode(id)} @ ${getPosText(id)} to be built in`, empty());
                }
                return empty();
            }
    
            return getBoundExprsOfSymbol(symbol, fix_run);
        }

        function getBoundExprsOfSymbol(symbol: ts.Symbol, fix_run: FixRunFunc<ts.Node, AbstractValue>): NodeLattice {
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
    
                    return getElementNodesOfArrayValuedNode(expression, { fixed_eval: node => fix_run(abstractEval, node), fixed_trace: node => fix_run(getWhereValueReturned, node), printNodeAndPos: printNode });
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
    
                    const objectConses = fix_run(abstractEval, initializer);
                    return getObjectsPropertyInitializers(objectConses, symbol.name);
                } else if (ts.isParameter(bindingElementSource)) {
                    const args = getArgumentsForParameter(bindingElementSource);
                    
                    const argsResults = nodeLatticeJoinMap(args, arg => fix_run(abstractEval, arg));

                    return getObjectsPropertyInitializers(argsResults, symbol.name);
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
                     * abstractEval will interpret as `topValue`, so that we don't need to dig
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
                );
                const boundFromArgs =  setMap(definingFunctionCallSites, (callSite) => {
                    return (callSite as CallExpression).arguments[parameterIndex] as Node;
                }) as NodeLattice;

                const sitesWhereDeclaringFunctionReturned = fix_run(getWhereValueReturned, declaringFunction);
                const boundFromPrimop = nodeLatticeFlatMap(
                    sitesWhereDeclaringFunctionReturned,
                    (node) => {
                        const callSiteWhereArg = node.parent;
                        if (!ts.isCallExpression(callSiteWhereArg)) {
                            return empty<NodeLatticeElem>();
                        }
                        const consumerValues = fix_run(abstractEval, callSiteWhereArg.expression);
                        const consumerConses = setFilter(consumerValues, value => {
                            return !isTop(value);
                        }) as SimpleSet<ts.Node>;

                        return setFlatMap(consumerConses, (cons) => {
                            if (!isBuiltInConstructorShaped(cons)) {
                                return empty();
                            }

                            const builtInValue = getBuiltInValueOfBuiltInConstructor(cons, node => fix_run(abstractEval, node), printNode);
                            const binderGetter = primopBinderGetters[builtInValue];
                            const argParameterIndex = declaration.parent.parameters.indexOf(declaration);
                            const primopArgIndex = callSiteWhereArg.arguments.indexOf(node as Expression);
                            const thisExpression = ts.isPropertyAccessExpression(callSiteWhereArg.expression)
                                ? callSiteWhereArg.expression.expression
                                : undefined;
                            return binderGetter.apply(thisExpression, [primopArgIndex, argParameterIndex, { fixed_eval: (node) => fix_run(abstractEval, node), fixed_trace: node => fix_run(getWhereValueReturned, node), printNodeAndPos: printNode }]);
                        }) as NodeLattice;
                    }
                );

                return union(boundFromArgs, boundFromPrimop);
            }
        }
    
        function getObjectsPropertyInitializers(objConstructors: NodeLattice, idName: string): NodeLattice {
            return nodeLatticeFlatMap(objConstructors, objConstructor => {
                if (!ts.isObjectLiteralExpression(objConstructor)) {
                    return unimplemented(`Destructuring non-object literals not yet implemented: ${printNode(objConstructor)} @ ${getPosText(objConstructor)}`, empty());
                }

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
        );

        return shorthandPropAssignment?.name;
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
