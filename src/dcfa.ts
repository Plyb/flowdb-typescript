import ts, { CallExpression, Expression, Node, SyntaxKind, ParameterDeclaration, ObjectLiteralExpression, PropertyAssignment } from 'typescript';
import { SimpleSet } from 'typescript-super-set';
import { empty, setFilter, setFlatMap, setMap, singleton, union } from './setUtil';
import { FixRunFunc, makeFixpointComputer } from './fixpoint';
import { structuralComparator } from './comparators';
import { getNodeAtPosition, getReturnStatements, isFunctionLikeDeclaration, isLiteral as isAtomicLiteral, SimpleFunctionLikeDeclaration, isAsync, isNullLiteral, isAsyncKeyword, Ambient, isPrismaQuery, printNodeAndPos, getPosText, NodePrinter, getThrowStatements } from './ts-utils';
import { AbstractValue, botValue, isExtern, joinAllValues, joinValue, NodeLattice, NodeLatticeElem, nodeLatticeFilter, nodeLatticeFlatMap, configSetJoinMap, nodeLatticeMap, configValue, pretty, setJoinMap, extern, externValue, unimplementedVal } from './abstract-values';
import { isBareSpecifier, consList, unimplemented } from './util';
// import { getBuiltInValueOfBuiltInConstructor, idIsBuiltIn, isBuiltInConstructorShaped, primopBinderGetters, resultOfCalling } from './value-constructors';
// import { getElementNodesOfArrayValuedNode, getObjectProperty, resolvePromisesOfNode } from './abstract-value-utils';
import { Config, ConfigSet, isIdentifierConfig, printConfig, pushContext, withZeroContext } from './configuration';

export type FixedEval = (config: Config) => ConfigSet;
export type FixedTrace = (config: Config) => ConfigSet;

const m = 0;

export function makeDcfaComputer(service: ts.LanguageService, targetFunction: SimpleFunctionLikeDeclaration): FixedEval {
    const program = service.getProgram()!;
    const typeChecker = program.getTypeChecker();

    const valueOf = makeFixpointComputer(empty<Config>(), {
        printArgs: printConfig,
        printRet: config => pretty(config).toString() 
    });
    
    return function dcfa(config: Config) {
    
        if (config.node === undefined) {
            throw new Error('no node at that position')
        }
        if (isExtern(config.node)) {
            throw new Error('Should not call dcfa on extern');
        }
        console.info(`dcfa for: ${printNodeAndPos(config.node)}`)

        if (isPrismaQuery(config.node.parent) && isOperatorOf(config.node, config.node.parent as CallExpression)) {
            console.info('Short cicuiting because this is a prisma query');
            return empty<Config>();
        }
    
        return valueOf({
            func: abstractEval,
            args: config,
        });
    
        // "eval"
        function abstractEval(config: Config, fix_run: FixRunFunc<Config, ConfigSet>): ConfigSet {    
            const fixed_eval: FixedEval = config => fix_run(abstractEval, config);
            // const fixed_trace: FixedTrace = node => fix_run(getWhereValueReturned, node);
            const { node, env } = config;

            if (isExtern(node)) {
                return configValue(config);
            } else if (isFunctionLikeDeclaration(node)) {
                return configValue(config);
            } else if (ts.isCallExpression(node)) {
                const operator: ts.Node = node.expression;
                const possibleOperators = fix_run(abstractEval, { node: operator, env });

                return configSetJoinMap(possibleOperators, (opConfig) => {
                    const op = opConfig.node;
                    if (isFunctionLikeDeclaration(op)) {
                        // if (isAsync(op)) {
                        //     return configValue(withZeroContext(op.modifiers!.find(isAsyncKeyword)!))
                        // } else {
                            const body: ts.Node = op.body;
                            return fix_run(abstractEval, { node: body, env: consList(pushContext(node, env, m), opConfig.env) });
                        // }
                    // } else if (isBuiltInConstructorShaped(op)) {
                    //     const builtInValue = getBuiltInValueOfBuiltInConstructor(op, fixed_eval, printNodeAndPos, targetFunction);
                    //     return resultOfCalling[builtInValue](node, { fixed_eval });
                    } else {
                        return unimplementedVal(`Unknown kind of operator: ${printNodeAndPos(node)}`);
                    }
                });
            } else if (isIdentifierConfig(config)) {
                // if (ts.isParameter(node.parent)) {
                //     // I believe we will only get here if the node is the parameter of the target function,
                //     // but let's do a sanity check just to make sure.
                //     if (node.parent.parent !== targetFunction) {
                //         return unimplementedVal(`Expected ${printNodeAndPos(node)} to be a parameter of the target function, but it was not`);
                //     }
                //     return configValue(config);
                // }

                const boundExprs = getBoundExprs(config, fix_run);
                if (boundExprs.size() > 0) {
                    return configSetJoinMap(boundExprs, fixed_eval);
                // } else if (idIsBuiltIn(node)) {
                //     return nodeValue(node);
                } else {
                    return unimplementedVal(`Could not find binding for ${printNodeAndPos(node)}`)
                }
            } else if (ts.isParenthesizedExpression(node)) {
                return fix_run(abstractEval, withZeroContext(node.expression));
            } else if (ts.isBlock(node)) {
                const returnStatements = [...getReturnStatements(node)];
                const returnStatementValues = returnStatements.map(returnStatement => {
                    if (returnStatement.expression === undefined) {
                        return empty<Config>();
                    }
                    return fix_run(abstractEval, withZeroContext(returnStatement.expression));
                });
                return joinAllValues(...returnStatementValues);
            } else if (isAtomicLiteral(node)) {
                return configValue(config);
            // } else if (ts.isObjectLiteralExpression(node)) {
            //     return nodeValue(node);
            // } else if (ts.isPropertyAccessExpression(node)) {
            //     if (!ts.isIdentifier(node.name)) {
            //         return unimplementedVal(`Expected simple identifier property access: ${node.name}`);
            //     }
    
            //     return getObjectProperty(node, fixed_eval, targetFunction);
            // } else if (ts.isAwaitExpression(node)) {
            //     return resolvePromisesOfNode(node.expression, fixed_eval);
            // } else if (ts.isArrayLiteralExpression(node)) {
            //     return nodeValue(node);
            // } else if (ts.isElementAccessExpression(node)) {
            //     const elementExpressions = getElementNodesOfArrayValuedNode(node.expression, { fixed_eval, fixed_trace, printNodeAndPos, targetFunction });
            //     return nodeLatticeJoinMap(elementExpressions, element => fix_run(abstractEval, element));
            // } else if (ts.isNewExpression(node)) {
            //     return nodeValue(node);
            // } else if (isNullLiteral(node)) {
            //     return nodeValue(node);
            // } else if (ts.isBinaryExpression(node)) {
            //     const lhsRes = fix_run(abstractEval, node.left);
            //     const rhsRes = fix_run(abstractEval, node.right);
            //     const primopId = node.operatorToken.kind;
            //     if (primopId === SyntaxKind.BarBarToken || primopId === SyntaxKind.QuestionQuestionToken) {
            //         return joinValue(lhsRes, rhsRes);
            //     } else {
            //         return unimplementedVal(`Unimplemented binary expression ${printNodeAndPos(node)}`);
            //     }
            // } else if (ts.isTemplateExpression(node)) {
            //     return nodeValue(node);
            // } else if (ts.isConditionalExpression(node)) {
            //     const thenValue = fix_run(abstractEval, node.whenTrue);
            //     const elseValue = fix_run(abstractEval, node.whenFalse);
            //     return joinValue(thenValue, elseValue)
            // } else if (ts.isAsExpression(node)) {
            //     return fix_run(abstractEval, node.expression);
            }
            return unimplementedVal(`abstractEval not yet implemented for: ${ts.SyntaxKind[node.kind]}:${getPosText(node)}`);
        }
        
        // "expr"
        function getWhereValueApplied(config: Config, fix_run: FixRunFunc<Config, ConfigSet>): ConfigSet {
            const operatorSites = nodeLatticeFilter(
                getWhereValueReturned(config, fix_run),
                funcConfig => ts.isCallExpression(funcConfig.node.parent) && isOperatorOf(funcConfig.node, funcConfig.node.parent)
            );
            return setMap(nodeLatticeMap(operatorSites, op => op.parent), withZeroContext);
        }
    
        function getWhereValueReturned(config: Config, fix_run: FixRunFunc<Config, ConfigSet>): ConfigSet {
            return joinValue(configValue(config), getWhereValueReturnedElsewhere(config, fix_run));
        }
    
        function getWhereValueReturnedElsewhere(config: Config, fix_run: FixRunFunc<Config, ConfigSet>): ConfigSet {
            const node = config.node;
            if (isExtern(node)) {
                return empty(); // TODO mcfa not sure if this is the right thing
            }

            const parent = node.parent;
            if (ts.isCallExpression(parent)) {
                if (isOperatorOf(node, parent)) {
                    return empty(); // If we're the operator, our value doesn't get propogated anywhere
                } else {
                    return getWhereReturnedInsideFunction(parent, node, (parameterName) =>
                        ts.isIdentifier(parameterName) 
                            ? getReferences(parameterName)
                            : empty() // If it's not an identifier, it's being destructured, so the value doesn't continue on
                    );
                }
            } else if (isFunctionLikeDeclaration(parent)) {
                const closedOverSites = fix_run(getWhereClosed, config);
                return configSetJoinMap(closedOverSites, site => fix_run(getWhereValueReturned, site));
            } else if (ts.isParenthesizedExpression(parent)) {
                return fix_run(getWhereValueReturned, withZeroContext(parent));
            } else if (ts.isVariableDeclaration(parent)) {
                if (!ts.isIdentifier(parent.name)) {
                    return empty(); // if it's not an identifier, we're destructuring it, which will return different values
                }
    
                const refs = getReferences(parent.name)
                return configSetJoinMap(refs, ref => fix_run(getWhereValueReturned, ref));
            } else if (ts.isFunctionDeclaration(node)) { // note that this is a little weird since we're not looking at the parent
                if (node.name === undefined) {
                    return unimplementedVal('function declaration should have name')
                }
    
                const refs = getReferences(node.name);
                return configSetJoinMap(refs, ref => fix_run(getWhereValueReturned, ref));
            // } else if (ts.isForOfStatement(parent) && parent.expression === node) {
            //     return botValue; // we're effectively "destructuring" the expression here, so the original value is gone
            // } else if (ts.isPropertyAccessExpression(parent)) {
            //     if (node != parent.expression) {
            //         return unimplementedVal(`Unknown situation for getWhereValueReturned: where to trace a child of propertyAccessExpression that isn't the expression for ${printNodeAndPos(node)} `)
            //     }

            //     return botValue;
            // } else if (ts.isShorthandPropertyAssignment(parent)) {
            //     const parentObjectReturnedAt = fix_run(getWhereValueReturned, parent.parent);
            //     return nodeLatticeJoinMap(parentObjectReturnedAt, returnLoc => {
            //         const returnLocParent = returnLoc.parent;
            //         if (ts.isCallExpression(returnLocParent) && !isOperatorOf(returnLoc, returnLocParent)) {
            //             return getWhereReturnedInsideFunction(returnLocParent, returnLoc, (parameterName) => {
            //                 if (!ts.isObjectBindingPattern(parameterName)) {
            //                     return empty();
            //                 }
            //                 const destructedName = parameterName.elements.find(elem => 
            //                     ts.isIdentifier(elem.name)
            //                         ? elem.name.text === parent.name.text
            //                         : unimplemented(`Nested binding patterns unimplemented: ${printNodeAndPos(elem)}`, empty())
            //                 )?.name;
            //                 if (destructedName === undefined) {
            //                     return unimplemented(`Unable to find destructed identifier in ${printNodeAndPos(parameterName)}`, empty())
            //                 }
            //                 if (!ts.isIdentifier(destructedName)) {
            //                     return unimplemented(`Expected a simple binding name ${printNodeAndPos(destructedName)}`, empty())
            //                 }

            //                 return getReferences(destructedName);
            //             })
            //         }
            //         return unimplementedVal(`Unknown value for obtaining ${parent.name.text} from object at ${printNodeAndPos(returnLocParent)}`);
            //     })
            }
            return unimplementedVal(`Unknown kind for getWhereValueReturned: ${SyntaxKind[parent.kind]}:${getPosText(parent)}`);

            function getWhereReturnedInsideFunction(parent: ts.CallExpression, node: ts.Node, getReferencesFromParameter: (name: ts.BindingName) => ConfigSet) {
                const argIndex = getArgumentIndex(parent, node);
                const possibleOperators = fix_run(
                    abstractEval, withZeroContext(parent.expression)
                );

                const possibleFunctions = nodeLatticeFilter(possibleOperators, config => isFunctionLikeDeclaration(config.node));
                const parameterReferences = configSetJoinMap(
                    possibleFunctions,
                    (funcConfig) => {
                        const parameterName = (funcConfig.node as SimpleFunctionLikeDeclaration).parameters[argIndex].name; // TODO mcfa deal with as
                        const refs = getReferencesFromParameter(parameterName);
                        return configSetJoinMap(refs, ref => fix_run(getWhereValueReturned, ref));
                    }
                );
                return configSetJoinMap(parameterReferences, (parameterRef) => fix_run(getWhereValueReturned, parameterRef));
            }
        }
        
        // "call"
        function getWhereClosed(config: Config, fix_run: FixRunFunc<Config, ConfigSet>): ConfigSet { // TODO mcfa make a DcfaFixRunFunc type
            const node = config.node;
            if (isExtern(node)) {
                return empty(); // TODO mcfa I'm not sure this is the right thing to do
            }
            
            if (!isFunctionLikeDeclaration(node.parent)) {
                return unimplementedVal(`Trying to find closure locations for ${SyntaxKind[node.kind]}`);
            }
    
            return fix_run(getWhereValueApplied, withZeroContext(node.parent))
        }
        
        // "find"
        function getReferences(id: ts.Identifier): ConfigSet {
            const refs = service
                .findReferences(id.getSourceFile().fileName, id.getStart())
                ?.flatMap(ref => ref.references)
                ?.filter(ref => !ref.isDefinition);
            if (refs === undefined) {
                return unimplemented('undefined references', empty());
            }
            const refNodes = refs.map(ref => getNodeAtPosition(
                program.getSourceFile(ref.fileName)!,
                ref.textSpan!.start,
                ref.textSpan!.length,
            )!);
            const refNodeConfigs = refNodes.map(withZeroContext);
            return new SimpleSet<Config>(structuralComparator, ...refNodeConfigs);
        }
        
        // "bind"
        function getBoundExprs(idConfig: Config<ts.Identifier>, fix_run: FixRunFunc<Config, ConfigSet>): ConfigSet {
            const id = idConfig.node;
            const symbol = typeChecker.getSymbolAtLocation(id);
            if (symbol === undefined) {
                return unimplemented(`Unable to find symbol ${id.text}`, empty())
            }

            // if ((symbol.valueDeclaration?.flags ?? 0) & Ambient) { // it seems like this happens with built in ids like `Date`
            //     if (!idIsBuiltIn(id)) {
            //         return unimplemented(`Expected ${printNodeAndPos(id)} to be built in`, empty());
            //     }
            //     return empty();
            // }
    
            return getBoundExprsOfSymbol(symbol, fix_run);
        }

        function getBoundExprsOfSymbol(symbol: ts.Symbol, fix_run: FixRunFunc<Config, ConfigSet>): ConfigSet {
            // const fixed_eval: FixedEval = node => fix_run(abstractEval, node);
            // const fixed_trace: FixedTrace = node => fix_run(getWhereValueReturned, node);

            const declaration = symbol.valueDeclaration
                ?? symbol?.declarations?.[0]; // it seems like this happens when the declaration is an import clause
            if (declaration === undefined) {
                return unimplemented(`could not find declaration: ${symbol.name}`, empty());
            }

            if (ts.isParameter(declaration)) {
                // if (declaration.parent === targetFunction) {
                //     return singleton<Config>(withZeroContext(declaration.name));
                // }

                return getArgumentsForParameter(declaration);
            } else if (ts.isVariableDeclaration(declaration)) {
                // if (ts.isForOfStatement(declaration.parent.parent)) {
                //     const forOfStatement = declaration.parent.parent;
                //     const expression = forOfStatement.expression;
    
                //     return getElementNodesOfArrayValuedNode(expression, { fixed_eval, fixed_trace, printNodeAndPos, targetFunction });
                // // } else if (ts.isCatchClause(declaration.parent)) {
                // //     const tryBlock = declaration.parent.parent.tryBlock;
                // //     const reachableBlocks = getReachableBlocks(tryBlock, fixed_eval);
                // //     const throwStatements = setFlatMap(reachableBlocks, setOf(getThrowStatements));
                // //     const thrownNodes = setMap(throwStatements, statement => statement.expression);
                // //     return asNodeLattice(thrownNodes);
                // } else { // it's a standard variable delcaration
                    if (declaration.initializer === undefined) {
                        return unimplementedVal(`Variable declaration should have initializer: ${SyntaxKind[declaration.kind]}:${getPosText(declaration)}`)
                    }
        
                    return singleton<Config>(withZeroContext(declaration.initializer));
                // }
            } else if (ts.isFunctionDeclaration(declaration)) {
                return singleton<Config>(withZeroContext(declaration));
            // } else if (ts.isBindingElement(declaration)) {
            //     const bindingElementSource = declaration.parent.parent;
            //     if (ts.isVariableDeclaration(bindingElementSource)) {
            //         const initializer = bindingElementSource.initializer;
            //         if (initializer === undefined) {
            //             return unimplementedVal(`Variable declaration should have initializer: ${SyntaxKind[declaration.kind]}:${getPosText(declaration)}`)
            //         }

            //         // special case for Promise.allSettled
            //         if (ts.isArrayBindingPattern(declaration.parent)
            //             && ts.isAwaitExpression(initializer)
            //             && ts.isCallExpression(initializer.expression)
            //             && ts.isPropertyAccessExpression(initializer.expression.expression)
            //             && ts.isIdentifier(initializer.expression.expression.expression)
            //             && initializer.expression.expression.expression.text === 'Promise'
            //             && initializer.expression.expression.name.text === 'allSettled'
            //             && ts.isArrayLiteralExpression(initializer.expression.arguments[0])
            //         ) {
            //             const index = declaration.parent.elements.indexOf(declaration);
            //             const arrayNode = initializer.expression.arguments[0];
            //             const arg = arrayNode.elements[index];
            //             // TODO: this isn't actually right, since it is just the raw value, not wrapped in the "settled result" thing
            //             return resolvePromisesOfNode(arg, fixed_eval);
            //         }
    
            //         const objectConses = fix_run(abstractEval, initializer);
            //         return getObjectsPropertyInitializers(objectConses, symbol.name);
            //     } else if (ts.isParameter(bindingElementSource)) {
            //         const args = getArgumentsForParameter(bindingElementSource);
                    
            //         const argsValues = nodeLatticeJoinMap(args, arg => fix_run(abstractEval, arg));

            //         return getObjectsPropertyInitializers(argsValues, symbol.name);
            //     }
            // } else if (ts.isImportClause(declaration) || ts.isImportSpecifier(declaration)) {
            //     const moduleSpecifier = ts.isImportClause(declaration)
            //         ? declaration.parent.moduleSpecifier
            //         : declaration.parent.parent.parent.moduleSpecifier;
    
            //     if (!ts.isStringLiteral(moduleSpecifier)) {
            //         throw new Error('Module specifier must be a string literal');
            //     }
    
            //     if (isBareSpecifier(moduleSpecifier.text)) {
            //         return singleton<NodeLatticeElem>(top);
            //     }

            //     const aliasedSymbol = typeChecker.getAliasedSymbol(symbol);
            //     return getBoundExprsOfSymbol(aliasedSymbol, fix_run);
            // } else if (ts.isShorthandPropertyAssignment(declaration)) {
            //     const shorthandValueSymbol = typeChecker.getShorthandAssignmentValueSymbol(declaration);
            //     if (shorthandValueSymbol === undefined) {
            //         throw new Error(`Should have gotten value symbol for shortand assignment: ${symbol.name} @ ${getPosText(declaration)}`)
            //     }
            //     return getBoundExprsOfSymbol(shorthandValueSymbol, fix_run);
            }
            return unimplementedVal(`getBoundExprs not yet implemented for ${ts.SyntaxKind[declaration.kind]}:${getPosText(declaration)}`);
    
            function getArgumentsForParameter(declaration: ParameterDeclaration): ConfigSet {
                const declaringFunction = declaration.parent;
                if (!isFunctionLikeDeclaration(declaringFunction)) {
                    return unimplementedVal('not yet implemented');
                }
                const parameterIndex = declaringFunction.parameters.indexOf(declaration);
                const definingFunctionBody = declaringFunction.body
        
                const definingFunctionCallSites = fix_run(
                    getWhereClosed, withZeroContext(definingFunctionBody)
                );
                const boundFromArgs =  nodeLatticeMap(definingFunctionCallSites, (callSite) => {
                    return (callSite as CallExpression).arguments[parameterIndex] as Node;
                });

                // const sitesWhereDeclaringFunctionReturned = fix_run(getWhereValueReturned, declaringFunction);
                // const boundFromPrimop = nodeLatticeFlatMap(
                //     sitesWhereDeclaringFunctionReturned,
                //     (node) => {
                //         const callSiteWhereArg = node.parent;
                //         if (!ts.isCallExpression(callSiteWhereArg)) {
                //             return empty<NodeLatticeElem>();
                //         }
                //         const consumerValues = fix_run(abstractEval, callSiteWhereArg.expression);
                //         const consumerConses = setFilter(consumerValues, value => {
                //             return !isTop(value);
                //         }) as SimpleSet<ts.Node>;

                //         return setFlatMap(consumerConses, (cons) => {
                //             if (!isBuiltInConstructorShaped(cons)) {
                //                 return empty();
                //             }

                //             const builtInValue = getBuiltInValueOfBuiltInConstructor(cons, fixed_eval, printNodeAndPos, targetFunction);
                //             const binderGetter = primopBinderGetters[builtInValue];
                //             const argParameterIndex = declaration.parent.parameters.indexOf(declaration);
                //             const primopArgIndex = callSiteWhereArg.arguments.indexOf(node as Expression);
                //             const thisExpression = ts.isPropertyAccessExpression(callSiteWhereArg.expression)
                //                 ? callSiteWhereArg.expression.expression
                //                 : undefined;
                //             return binderGetter.apply(thisExpression, [primopArgIndex, argParameterIndex, { fixed_eval, fixed_trace, printNodeAndPos, targetFunction }]);
                //         }) as NodeLattice;
                //     }
                // );

                // return union(boundFromArgs, boundFromPrimop);
                return setMap(boundFromArgs, withZeroContext);
            }
        }
    
        // function getObjectsPropertyInitializers(objConstructors: NodeLattice, idName: string): NodeLattice {
        //     return nodeLatticeFlatMap(objConstructors, objConstructor => {
        //         if (!ts.isObjectLiteralExpression(objConstructor)) {
        //             return unimplemented(`Destructuring non-object literals not yet implemented: ${printNodeAndPos(objConstructor)}`, empty());
        //         }

        //         const initializer = getObjectPropertyInitializer(objConstructor as ObjectLiteralExpression, idName);
                
        //         return initializer !== undefined
        //             ? singleton<NodeLatticeElem>(initializer)
        //             : empty<NodeLatticeElem>();
        //     });
        // }
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
