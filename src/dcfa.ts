import ts, { CallExpression, Expression, Node, SyntaxKind, ParameterDeclaration, ObjectLiteralExpression, PropertyAssignment, isConciseBody } from 'typescript';
import { SimpleSet } from 'typescript-super-set';
import { empty, setFilter, setFlatMap, setOf, singleton, union } from './setUtil';
import { FixRunFunc, makeFixpointComputer } from './fixpoint';
import { structuralComparator } from './comparators';
import { getNodeAtPosition, getReturnStatements, isFunctionLikeDeclaration, isLiteral as isAtomicLiteral, SimpleFunctionLikeDeclaration, isAsync, isNullLiteral, isAsyncKeyword, Ambient, isPrismaQuery, printNodeAndPos, getPosText, getThrowStatements, getDeclaringScope, getParentChain, shortenEnvironmentToScope } from './ts-utils';
import { isExtern, joinAllValues, joinValue, configSetJoinMap, configValue, pretty, externValue, unimplementedVal } from './abstract-values';
import { isBareSpecifier, consList, unimplemented } from './util';
import { getBuiltInValueOfBuiltInConstructor, idIsBuiltIn, isBuiltInConstructorShapedConfig, primopBinderGetters, resultOfCalling } from './value-constructors';
import { getElementNodesOfArrayValuedNode, getObjectProperty, resolvePromisesOfNode } from './abstract-value-utils';
import { Config, ConfigSet, configSetFilter, configSetMap, Environment, isCallConfig, isConfigNoExtern, isFunctionLikeDeclarationConfig, isIdentifierConfig, isPropertyAccessConfig, newQuestion, printConfig, pushContext } from './configuration';
import { isEqual } from 'lodash';
import { getReachableBlocks } from './control-flow';

export type FixedEval = (config: Config) => ConfigSet;
export type FixedTrace = (config: Config) => ConfigSet;

export function makeDcfaComputer(service: ts.LanguageService, targetFunction: SimpleFunctionLikeDeclaration, m: number): FixedEval {
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
            const fixed_trace: FixedTrace = node => fix_run(getWhereValueReturned, node);
            
            if (!isConfigNoExtern(config)) {
                return configValue(config);
            }
            const { node, env } = config;
            
            if (isFunctionLikeDeclaration(node)) {
                return configValue(config);
            } else if (isCallConfig(config)) {
                const call = config.node;
                const operator: ts.Node = call.expression;
                const possibleOperators = fix_run(abstractEval, { node: operator, env });

                return configSetJoinMap(possibleOperators, (opConfig) => {
                    const op = opConfig.node;
                    if (isFunctionLikeDeclaration(op)) {
                        if (isAsync(op)) {
                            return configValue({
                                node: op.modifiers!.find(isAsyncKeyword)!,
                                env: consList(pushContext(call, env, m), opConfig.env)
                            })
                        } else {
                            const body: ts.Node = op.body;
                            return fix_run(abstractEval, {
                                node: body,
                                env: consList(pushContext(call, env, m), opConfig.env) 
                            });
                        }
                    } else if (isBuiltInConstructorShapedConfig(opConfig)) {
                        const builtInValue = getBuiltInValueOfBuiltInConstructor(
                            opConfig,
                            fixed_eval, targetFunction
                        );
                        return resultOfCalling[builtInValue](config, { fixed_eval });
                    } else {
                        return unimplementedVal(`Unknown kind of operator: ${printNodeAndPos(node)}`);
                    }
                });
            } else if (isIdentifierConfig(config)) {
                if (ts.isParameter(node.parent)) {
                    // I believe we will only get here if the node is the parameter of the target function,
                    // but let's do a sanity check just to make sure.
                    if (node.parent.parent !== targetFunction) {
                        return unimplementedVal(`Expected ${printNodeAndPos(node)} to be a parameter of the target function, but it was not`);
                    }
                    return configValue(config);
                }

                const boundExprs = getBoundExprs(config, fix_run);
                if (boundExprs.size() > 0) {
                    return configSetJoinMap(boundExprs, fixed_eval);
                } else if (idIsBuiltIn(config.node)) {
                    return configValue(config);
                } else {
                    return unimplementedVal(`Could not find binding for ${printNodeAndPos(node)}`)
                }
            } else if (ts.isParenthesizedExpression(node)) {
                return fix_run(abstractEval, { node: node.expression, env });
            } else if (ts.isBlock(node)) {
                const returnStatements = [...getReturnStatements(node)];
                const returnStatementValues = returnStatements.map(returnStatement => {
                    if (returnStatement.expression === undefined) {
                        return empty<Config>();
                    }
                    return fix_run(abstractEval, { node: returnStatement.expression, env });
                });
                return joinAllValues(...returnStatementValues);
            } else if (isAtomicLiteral(node)) {
                return configValue(config);
            } else if (ts.isObjectLiteralExpression(node)) {
                return configValue(config);
            } else if (isPropertyAccessConfig(config)) {
                if (!ts.isIdentifier(config.node.name)) {
                    return unimplementedVal(`Expected simple identifier property access: ${config.node.name}`);
                }
    
                return getObjectProperty(config, fixed_eval, targetFunction);
            } else if (ts.isAwaitExpression(node)) {
                return resolvePromisesOfNode({ node: node.expression, env }, fixed_eval);
            } else if (ts.isArrayLiteralExpression(node)) {
                return configValue(config);
            } else if (ts.isElementAccessExpression(node)) {
                const elementExpressions = getElementNodesOfArrayValuedNode(
                    { node: node.expression, env },
                    { fixed_eval, fixed_trace, targetFunction, m }
                );
                return configSetJoinMap(elementExpressions, element => fix_run(abstractEval, element));
            } else if (ts.isNewExpression(node)) {
                return configValue(config);
            } else if (isNullLiteral(node)) {
                return configValue(config);
            } else if (ts.isBinaryExpression(node)) {
                const lhsRes = fix_run(abstractEval, { node: node.left, env });
                const rhsRes = fix_run(abstractEval, { node: node.right, env });
                const primopId = node.operatorToken.kind;
                if (primopId === SyntaxKind.BarBarToken || primopId === SyntaxKind.QuestionQuestionToken) {
                    return joinValue(lhsRes, rhsRes);
                } else {
                    return unimplementedVal(`Unimplemented binary expression ${printNodeAndPos(node)}`);
                }
            } else if (ts.isTemplateExpression(node)) {
                return configValue(config);
            } else if (ts.isConditionalExpression(node)) {
                const thenValue = fix_run(abstractEval, { node: node.whenTrue, env });
                const elseValue = fix_run(abstractEval, { node: node.whenFalse, env });
                return joinValue(thenValue, elseValue)
            } else if (ts.isAsExpression(node)) {
                return fix_run(abstractEval, { node: node.expression, env });
            }
            return unimplementedVal(`abstractEval not yet implemented for: ${ts.SyntaxKind[node.kind]}:${getPosText(node)}`);
        }
        
        // "expr"
        function getWhereValueApplied(config: Config, fix_run: FixRunFunc<Config, ConfigSet>): ConfigSet {
            const operatorSites = configSetFilter(
                getWhereValueReturned(config, fix_run),
                funcConfig => ts.isCallExpression(funcConfig.node.parent) && isOperatorOf(funcConfig.node, funcConfig.node.parent)
            );
            return configSetMap(operatorSites, config => ({ node: config.node.parent, env: config.env }));
        }
    
        function getWhereValueReturned(config: Config, fix_run: FixRunFunc<Config, ConfigSet>): ConfigSet {
            return joinValue(configValue(config), getWhereValueReturnedElsewhere(config, fix_run));
        }
    
        function getWhereValueReturnedElsewhere(config: Config, fix_run: FixRunFunc<Config, ConfigSet>): ConfigSet {
            const { node, env } = config;
            if (isExtern(node)) {
                return empty();
            }

            const parent = node.parent;
            if (ts.isCallExpression(parent)) {
                if (isOperatorOf(node, parent)) {
                    return empty(); // If we're the operator, our value doesn't get propogated anywhere
                } else {
                    return getWhereReturnedInsideFunction({ node: parent, env }, node, (parameterName, opEnv) =>
                        ts.isIdentifier(parameterName) 
                            ? getReferences({ node: parameterName, env: consList(pushContext(parent, env, m), opEnv) })
                            : empty() // If it's not an identifier, it's being destructured, so the value doesn't continue on
                    );
                }
            } else if (isFunctionLikeDeclaration(parent) && isBodyOf(node, parent)) {
                const closedOverSites = fix_run(getWhereClosed, config);
                return configSetJoinMap(closedOverSites, site => fix_run(getWhereValueReturned, site));
            } else if (ts.isParenthesizedExpression(parent)) {
                return fix_run(getWhereValueReturned, { node: parent, env });
            } else if (ts.isVariableDeclaration(parent)) {
                if (!ts.isIdentifier(parent.name)) {
                    return empty(); // if it's not an identifier, we're destructuring it, which will return different values
                }
    
                const refs = getReferences({ node: parent.name, env })
                return configSetJoinMap(refs, ref => fix_run(getWhereValueReturned, ref));
            } else if (ts.isFunctionDeclaration(node)) { // note that this is a little weird since we're not looking at the parent
                if (node.name === undefined) {
                    return unimplementedVal('function declaration should have name')
                }
    
                const refs = getReferences({ node: node.name, env });
                return configSetJoinMap(refs, ref => fix_run(getWhereValueReturned, ref));
            } else if (ts.isForOfStatement(parent) && parent.expression === node) {
                return empty(); // we're effectively "destructuring" the expression here, so the original value is gone
            } else if (ts.isPropertyAccessExpression(parent)) {
                if (node != parent.expression) {
                    return unimplementedVal(`Unknown situation for getWhereValueReturned: where to trace a child of propertyAccessExpression that isn't the expression for ${printNodeAndPos(node)} `)
                }

                return empty();
            } else if (ts.isShorthandPropertyAssignment(parent)) {
                const parentObjectReturnedAt = fix_run(getWhereValueReturned, { node: parent.parent, env });
                return configSetJoinMap(parentObjectReturnedAt, returnLocConfig => {
                    const { node: returnLoc, env: returnLocEnv } = returnLocConfig;
                    const returnLocParent = returnLoc.parent;
                    if (ts.isCallExpression(returnLocParent) && !isOperatorOf(returnLoc, returnLocParent)) {
                        return getWhereReturnedInsideFunction(
                            { node: returnLocParent, env: returnLocEnv },
                            returnLoc,
                            (parameterName, opEnv) => {
                                if (!ts.isObjectBindingPattern(parameterName)) {
                                    return empty();
                                }
                                const destructedName = parameterName.elements.find(elem => 
                                    ts.isIdentifier(elem.name)
                                        ? elem.name.text === parent.name.text
                                        : unimplemented(`Nested binding patterns unimplemented: ${printNodeAndPos(elem)}`, empty())
                                )?.name;
                                if (destructedName === undefined) {
                                    return unimplemented(`Unable to find destructed identifier in ${printNodeAndPos(parameterName)}`, empty())
                                }
                                if (!ts.isIdentifier(destructedName)) {
                                    return unimplemented(`Expected a simple binding name ${printNodeAndPos(destructedName)}`, empty())
                                }

                                return getReferences({
                                    node: destructedName,
                                    env: consList(pushContext(returnLocParent, returnLocEnv, m), opEnv),
                                });
                            }
                        )
                    }
                    return unimplementedVal(`Unknown value for obtaining ${parent.name.text} from object at ${printNodeAndPos(returnLocParent)}`);
                })
            }
            return unimplementedVal(`Unknown kind for getWhereValueReturned: ${SyntaxKind[parent.kind]}:${getPosText(parent)}`);

            function getWhereReturnedInsideFunction(parentConfig: Config<ts.CallExpression>, node: ts.Node, getReferencesFromParameter: (name: ts.BindingName, opEnv: Environment) => ConfigSet) {
                const parent = parentConfig.node;
                const argIndex = getArgumentIndex(parent, node);
                const possibleOperators = fix_run(
                    abstractEval, { node: parent.expression, env: parentConfig.env }
                );

                const possibleFunctions = configSetFilter(possibleOperators, isFunctionLikeDeclarationConfig);
                const parameterReferences = configSetJoinMap(
                    possibleFunctions,
                    (funcConfig) => {
                        const parameterName = funcConfig.node.parameters[argIndex].name;
                        const refs = getReferencesFromParameter(parameterName, funcConfig.env);
                        return configSetJoinMap(refs, ref => fix_run(getWhereValueReturned, ref));
                    }
                );
                return configSetJoinMap(parameterReferences, (parameterRef) => fix_run(getWhereValueReturned, parameterRef));
            }
        }
        
        // "call"
        function getWhereClosed(config: Config, fix_run: FixRunFunc<Config, ConfigSet>): ConfigSet {
            const { node, env } = config;
            if (isExtern(node)) {
                return empty();
            }
            
            if (!isFunctionLikeDeclaration(node.parent) || !isConciseBody(node)) {
                return unimplementedVal(`Trying to find closure locations for ${SyntaxKind[node.kind]}`);
            }

            const applicationSites = fix_run(getWhereValueApplied, { node: node.parent, env: env.tail });
    
            return configSetFilter(applicationSites, siteConfig => {
                const site = siteConfig.node;
                if (!ts.isCallExpression(site)) {
                    return unimplemented(`Got non-callsite from getWhereValueApplied: ${printNodeAndPos(site)}`, false);
                }

                const contextFromCallSite = pushContext(site, siteConfig.env, m);
                return isEqual(contextFromCallSite, env.head);
            });
        }
        
        // "find"
        function getReferences(idConfig: Config<ts.Identifier>): ConfigSet {
            const { node: id, env: idEnv } = idConfig;
            const symbol = typeChecker.getSymbolAtLocation(id);
            const declaration = symbol?.valueDeclaration;
            if (declaration === undefined) {
                throw new Error(`Could not find declaration for ${printNodeAndPos(id)}`);
            }
            const scope = getDeclaringScope(declaration, typeChecker);

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
            const refNodeConfigs: Config[] = refNodes.flatMap(refNode => {
                const parents = getParentChain(refNode);
                let env = idEnv;
                for (const parent of parents) {
                    if (parent === scope) {
                        return [{
                            node: refNode,
                            env
                        }]
                    }
                    if (isFunctionLikeDeclaration(parent)) {
                        env = consList(newQuestion(parent), env);
                    }
                }
                return [];  // We get here if the refNode's parent chain never hits the declaring scope.
                            // If that is the case, the ts compiler has given us a false positive as a
                            // reference.
            });
            return new SimpleSet<Config>(structuralComparator, ...refNodeConfigs);
        }
        
        // "bind"
        function getBoundExprs(idConfig: Config<ts.Identifier>, fix_run: FixRunFunc<Config, ConfigSet>): ConfigSet {
            const { node: id } = idConfig;
            const symbol = typeChecker.getSymbolAtLocation(id);
            if (symbol === undefined) {
                return unimplemented(`Unable to find symbol ${id.text}`, empty())
            }

            if ((symbol.valueDeclaration?.flags ?? 0) & Ambient) { // it seems like this happens with built in ids like `Date`
                if (!idIsBuiltIn(id)) {
                    return unimplemented(`Expected ${printNodeAndPos(id)} to be built in`, empty());
                }
                return empty();
            }
    
            return getBoundExprsOfSymbol(symbol, idConfig, fix_run);
        }

        function getBoundExprsOfSymbol(symbol: ts.Symbol, idConfig: Config<ts.Identifier>, fix_run: FixRunFunc<Config, ConfigSet>): ConfigSet {
            const fixed_eval: FixedEval = node => fix_run(abstractEval, node);
            const fixed_trace: FixedTrace = node => fix_run(getWhereValueReturned, node);

            const declaration = symbol.valueDeclaration
                ?? symbol?.declarations?.[0]; // it seems like this happens when the declaration is an import clause
            if (declaration === undefined) {
                return unimplemented(`could not find declaration: ${symbol.name}`, empty());
            }
            const declaringScope = getDeclaringScope(declaration, typeChecker);
            const envAtDeclaringScope = shortenEnvironmentToScope(idConfig, declaringScope);

            if (ts.isParameter(declaration)) {
                if (declaration.parent === targetFunction) {
                    return singleton<Config>({ node: declaration.name, env: envAtDeclaringScope });
                }

                return getArgumentsForParameter(declaration, envAtDeclaringScope);
            } else if (ts.isVariableDeclaration(declaration)) {
                if (ts.isForOfStatement(declaration.parent.parent)) {
                    const forOfStatement = declaration.parent.parent;
                    const expression = forOfStatement.expression;
    
                    return getElementNodesOfArrayValuedNode(
                        { node: expression, env: envAtDeclaringScope },
                        { fixed_eval, fixed_trace, targetFunction, m }
                    );
                } else if (ts.isCatchClause(declaration.parent)) {
                    const tryBlock = declaration.parent.parent.tryBlock;
                    const reachableBlocks = getReachableBlocks({ node: tryBlock, env: envAtDeclaringScope }, m, fixed_eval);
                    const thrownNodeConfigs = setFlatMap(reachableBlocks, setOf(blockConfig => {
                        const throwStatements = getThrowStatements(blockConfig.node);
                        return [...throwStatements].map(throwStatement => ({
                            node: throwStatement.expression,
                            env: blockConfig.env,
                        } as Config<ts.Expression>));
                    }));
                    return thrownNodeConfigs;
                } else { // it's a standard variable delcaration
                    if (declaration.initializer === undefined) {
                        return unimplementedVal(`Variable declaration should have initializer: ${SyntaxKind[declaration.kind]}:${getPosText(declaration)}`)
                    }
        
                    return singleton<Config>({
                        node: declaration.initializer,
                        env: envAtDeclaringScope,
                    });
                }
            } else if (ts.isFunctionDeclaration(declaration)) {
                return singleton<Config>({
                    node: declaration,
                    env: envAtDeclaringScope,
                });
            } else if (ts.isBindingElement(declaration)) {
                const bindingElementSource = declaration.parent.parent;
                if (ts.isVariableDeclaration(bindingElementSource)) {
                    const initializer = bindingElementSource.initializer;
                    if (initializer === undefined) {
                        return unimplementedVal(`Variable declaration should have initializer: ${SyntaxKind[declaration.kind]}:${getPosText(declaration)}`)
                    }

                    // // special case for Promise.allSettled
                    // if (ts.isArrayBindingPattern(declaration.parent)
                    //     && ts.isAwaitExpression(initializer)
                    //     && ts.isCallExpression(initializer.expression)
                    //     && ts.isPropertyAccessExpression(initializer.expression.expression)
                    //     && ts.isIdentifier(initializer.expression.expression.expression)
                    //     && initializer.expression.expression.expression.text === 'Promise'
                    //     && initializer.expression.expression.name.text === 'allSettled'
                    //     && ts.isArrayLiteralExpression(initializer.expression.arguments[0])
                    // ) {
                    //     const index = declaration.parent.elements.indexOf(declaration);
                    //     const arrayNode = initializer.expression.arguments[0];
                    //     const arg = arrayNode.elements[index];
                    //     // TODO: this isn't actually right, since it is just the raw value, not wrapped in the "settled result" thing
                    //     return resolvePromisesOfNode(arg, fixed_eval);
                    // }
    
                    const objectConsConfigs = fixed_eval({ node: initializer, env: envAtDeclaringScope });
                    return getObjectsPropertyInitializers(objectConsConfigs, symbol.name);
                } else if (ts.isParameter(bindingElementSource)) {
                    const argConfigs = getArgumentsForParameter(bindingElementSource, envAtDeclaringScope);
                    
                    const argsValues = configSetJoinMap(argConfigs, argConfig => fix_run(abstractEval, argConfig));

                    return getObjectsPropertyInitializers(argsValues, symbol.name);
                }
            } else if (ts.isImportClause(declaration) || ts.isImportSpecifier(declaration)) {
                const moduleSpecifier = ts.isImportClause(declaration)
                    ? declaration.parent.moduleSpecifier
                    : declaration.parent.parent.parent.moduleSpecifier;
    
                if (!ts.isStringLiteral(moduleSpecifier)) {
                    throw new Error('Module specifier must be a string literal');
                }
    
                if (isBareSpecifier(moduleSpecifier.text)) {
                    return externValue;
                }

                const aliasedSymbol = typeChecker.getAliasedSymbol(symbol);
                return getBoundExprsOfSymbol(aliasedSymbol, idConfig, fix_run);
            } else if (ts.isShorthandPropertyAssignment(declaration)) {
                const shorthandValueSymbol = typeChecker.getShorthandAssignmentValueSymbol(declaration);
                if (shorthandValueSymbol === undefined) {
                    throw new Error(`Should have gotten value symbol for shortand assignment: ${symbol.name} @ ${getPosText(declaration)}`)
                }
                return getBoundExprsOfSymbol(shorthandValueSymbol, idConfig, fix_run);
            }
            return unimplementedVal(`getBoundExprs not yet implemented for ${ts.SyntaxKind[declaration.kind]}:${getPosText(declaration)}`);
    
            function getArgumentsForParameter(declaration: ParameterDeclaration, envAtDeclaredScope: Environment): ConfigSet {
                const declaringFunction = declaration.parent;
                if (!isFunctionLikeDeclaration(declaringFunction)) {
                    return unimplementedVal('not yet implemented');
                }
                const parameterIndex = declaringFunction.parameters.indexOf(declaration);
                const declaringFunctionBody = declaringFunction.body
        
                const definingFunctionCallSites = fix_run(
                    getWhereClosed, { node: declaringFunctionBody, env: envAtDeclaredScope }
                );
                const boundFromArgs =  configSetMap(definingFunctionCallSites, (callSite) => ({
                    node: (callSite.node as CallExpression).arguments[parameterIndex] as Node,
                    env: callSite.env,
                }));

                const sitesWhereDeclaringFunctionReturned = fixed_trace({ node: declaringFunction, env: envAtDeclaredScope });
                const boundFromPrimop = configSetJoinMap(
                    sitesWhereDeclaringFunctionReturned,
                    (config) => {
                        const { node, env: callSiteEnv } = config;
                        const callSiteWhereArg = node.parent;
                        if (!ts.isCallExpression(callSiteWhereArg)) {
                            return empty();
                        }
                        const consumerConfigsAndExterns = fixed_eval({ node: callSiteWhereArg.expression, env: callSiteEnv });
                        const consumerConfigs = setFilter(consumerConfigsAndExterns, isConfigNoExtern);

                        return setFlatMap(consumerConfigs, (config) => {
                            if (!isBuiltInConstructorShapedConfig(config)) {
                                return empty();
                            }

                            const builtInValue = getBuiltInValueOfBuiltInConstructor(config, fixed_eval, targetFunction);
                            const binderGetter = primopBinderGetters[builtInValue];
                            const argParameterIndex = declaration.parent.parameters.indexOf(declaration);
                            const primopArgIndex = callSiteWhereArg.arguments.indexOf(node as Expression);
                            const thisConfig = ts.isPropertyAccessExpression(callSiteWhereArg.expression)
                                ? {
                                    node: callSiteWhereArg.expression.expression,
                                    env: callSiteEnv
                                }
                                : undefined;
                            return binderGetter.apply(thisConfig, [primopArgIndex, argParameterIndex, { fixed_eval, fixed_trace, targetFunction, m }]);
                        });
                    }
                );

                return union(boundFromArgs, boundFromPrimop);
            }
        }
    
        function getObjectsPropertyInitializers(objConstructorConfigs: ConfigSet, idName: string): ConfigSet {
            return configSetJoinMap(objConstructorConfigs, ({ node: objConstructor, env }) => {
                if (!ts.isObjectLiteralExpression(objConstructor)) {
                    return unimplemented(`Destructuring non-object literals not yet implemented: ${printNodeAndPos(objConstructor)}`, empty());
                }

                const initializer = getObjectPropertyInitializer(objConstructor as ObjectLiteralExpression, idName);
                
                return initializer !== undefined
                    ? configValue({ node: initializer, env})
                    : empty();
            });
        }
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

function isBodyOf(node: ts.Node, func: SimpleFunctionLikeDeclaration) {
    return node === func.body;
}
