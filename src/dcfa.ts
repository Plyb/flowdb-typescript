import ts, { CallExpression, Expression, Node, SyntaxKind, ParameterDeclaration, ObjectLiteralExpression, PropertyAssignment, SymbolFlags, ScriptElementKind } from 'typescript';
import { empty, setFilter, setFlatMap, setOf, setSome, union } from './setUtil';
import { CachePusher, Computation, FixRunFunc, makeFixpointComputer } from './fixpoint';
import { getNodeAtPosition, getReturnStatements, isFunctionLikeDeclaration, isLiteral as isAtomicLiteral, SimpleFunctionLikeDeclaration, isAsync, isNullLiteral, isAsyncKeyword, Ambient, printNodeAndPos, getPosText, getThrowStatements, getDeclaringScope, getParentChain, shortenEnvironmentToScope, isPrismaQuery, getModuleSpecifier, isOnLhsOfAssignmentExpression, getFunctionBlockOf, isAssignmentExpression, isParenthesizedExpression, isBlock, isObjectLiteralExpression, isAwaitExpression, isArrayLiteralExpression, isElementAccessExpression, isNewExpression, isBinaryExpression, isTemplateExpression, isConditionalExpression, isAsExpression, isClassDeclaration, isFunctionDeclaration, isMethodDeclaration, isDecorator, isConciseBody, isCallExpression, isImportSpecifier, isParameter, isPrivate, isIdentifier, findAll, isEnumDeclaration, getPrimarySymbol } from './ts-utils';
import { AnalysisNode, AnalysisSyntaxKind, createArgumentList, isArgumentList, isElementPick, isExtern, sourceFileOf } from './abstract-values';
import { unimplemented } from './util';
import { builtInValueBehaviors, getBuiltInValueOfBuiltInConstructor, idIsBuiltIn, isBuiltInConstructorShapedConfig } from './value-constructors';
import { getElementNodesOfArrayValuedNode, getElementOfArrayOfTuples, getElementOfTuple, getObjectProperty, resolvePromisesOfNode, subsumes } from './abstract-value-utils';
import { Config, ConfigSet, configSetFilter, configSetMap, Environment, justExtern, isCallConfig, isConfigNoExtern, isFunctionLikeDeclarationConfig, isIdentifierConfig, isPropertyAccessConfig, printConfig, pushContext, singleConfig, join, joinAll, configSetJoinMap, pretty, unimplementedBottom, envKey, envValue, getRefinementsOf, ConfigNoExtern, ConfigSetNoExtern, isElementAccessConfig, isAssignmentExpressionConfig, isSpreadAssignmentConfig, isVariableDeclarationConfig, ConfigObject, withUnknownContext, isConfigExtern } from './configuration';
import { getReachableBlocks } from './control-flow';
import { newQuestion, refines } from './context';
import Immutable, { Set } from 'immutable';

export type FixedEval = (config: Config) => ConfigSet;
export type FixedTrace = (config: Config) => ConfigSet;
export type DcfaCachePusher = CachePusher<Config, ConfigSet>;

export function makeDcfaComputer(service: ts.LanguageService, targetFunction: SimpleFunctionLikeDeclaration, m: number): { fixed_eval: FixedEval, fixed_trace: FixedTrace, push_cache: DcfaCachePusher } {
    const program = service.getProgram()!;
    const typeChecker = program.getTypeChecker();

    const { valueOf, push_cache } = makeFixpointComputer(empty<Config>(), join, {
        printArgs: printConfig,
        printRet: config => pretty(config).toString() 
    });
    
    return {
        fixed_eval: dcfa,
        fixed_trace: valueOfTrace,
        push_cache,
    }

    function dcfa(config: Config) {
    
        if (config.node === undefined) {
            throw new Error('no node at that position')
        }
        if (isExtern(config.node)) {
            throw new Error('Should not call dcfa on extern');
        }
        console.info(`dcfa for: ${printNodeAndPos(config.node)}`);
    
        return valueOf(Computation({
            func: abstractEval,
            args: config,
        }));
    }

    function valueOfTrace(config: Config) {
        return valueOf(Computation({
            func: getWhereValueReturned,
            args: config
        }));
    }

    // "eval"
    function abstractEval(config: Config, fix_run: FixRunFunc<Config, ConfigSet>, push_cache: DcfaCachePusher): ConfigSet {    
        const fixed_eval: FixedEval = config => fix_run(abstractEval, config);
        const fixed_trace: FixedTrace = node => fix_run(getWhereValueReturned, node);

        return join(
            abstractEvalCurrentConfig(),
            setFlatMap(getRefinementsOf(config, fix_run), (refinedConfig) => fix_run(abstractEval, refinedConfig))
        );
        
        function abstractEvalCurrentConfig(): ConfigSet {
            if (!isConfigNoExtern(config)) {
                return singleConfig(config);
            }
            const { node, env } = config;
            
            if (isFunctionLikeDeclaration(node)) {
                return singleConfig(config);
            } else if (isCallConfig(config)) {
                if (isPrismaQuery(config.node)) {
                    return justExtern;
                }

                const call = config.node;
                const operator: ts.Node = call.expression;
                const possibleOperators = fixed_eval(Config({ node: operator, env }));

                return configSetJoinMap(possibleOperators, (opConfig) => {
                    const op = opConfig.node;
                    if (isFunctionLikeDeclaration(op)) {
                        push_cache(
                            envKey(opConfig.env.push(newQuestion(op))),
                            envValue(opConfig.env.push(pushContext(call, env, m)))
                        );
                        if (isAsync(op)) {
                            return singleConfig(Config({
                                node: op.modifiers!.find(isAsyncKeyword)!,
                                env: opConfig.env.push(pushContext(call, env, m))
                            }))
                        } else {
                            const body: ts.Node = op.body;
                            return fixed_eval(Config({
                                node: body,
                                env: opConfig.env.push(pushContext(call, env, m))
                            }));
                        }
                    } else if (isBuiltInConstructorShapedConfig(opConfig)) {
                        const builtInValue = getBuiltInValueOfBuiltInConstructor(
                            opConfig,
                            fixed_eval
                        );
                        return builtInValueBehaviors[builtInValue].resultOfCalling(config, { fixed_eval, fixed_trace, m });
                    } else {
                        return unimplementedBottom(`Unknown kind of operator: ${printNodeAndPos(node)}`);
                    }
                });
            } else if (isIdentifierConfig(config)) {
                if (config.node.text === 'globalThis' || config.node.text === 'global') {
                    return justExtern;
                }

                const boundExprs = getBoundExprs(config, fix_run);
                if (boundExprs.size > 0) {
                    return configSetJoinMap(boundExprs, fixed_eval);
                } else if (idIsBuiltIn(config.node)) {
                    return singleConfig(config);
                } else {
                    return unimplementedBottom(`Could not find binding for ${printNodeAndPos(node)}`)
                }
            } else if (isParenthesizedExpression(node)) {
                return fixed_eval(Config({ node: node.expression, env }));
            } else if (isBlock(node)) {
                const returnStatements = [...getReturnStatements(node)];
                const returnStatementValues = returnStatements.map(returnStatement => {
                    if (returnStatement.expression === undefined) {
                        return empty<Config>();
                    }
                    return fixed_eval(Config({ node: returnStatement.expression, env }));
                });
                return joinAll(...returnStatementValues);
            } else if (isAtomicLiteral(node)) {
                return singleConfig(config);
            } else if (isObjectLiteralExpression(node)) {
                return singleConfig(config);
            } else if (isPropertyAccessConfig(config)) {
                if (!ts.isIdentifier(config.node.name)) {
                    return unimplementedBottom(`Expected simple identifier property access: ${printNodeAndPos(config.node.name)}`);
                }
    
                return getObjectProperty(config, typeChecker, fixed_eval, fixed_trace);
            } else if (isAwaitExpression(node)) {
                return resolvePromisesOfNode(Config({ node: node.expression, env }), fixed_eval);
            } else if (isArrayLiteralExpression(node)) {
                return singleConfig(config);
            } else if (isElementAccessExpression(node)) {
                const elementExpressions = getElementNodesOfArrayValuedNode(
                    Config({ node: node.expression, env }),
                    { fixed_eval, fixed_trace, m },
                );
                return configSetJoinMap(elementExpressions, element => fix_run(abstractEval, element));
            } else if (isNewExpression(node)) {
                return singleConfig(config);
            } else if (isNullLiteral(node)) {
                return singleConfig(config);
            } else if (isBinaryExpression(node)) {
                const primopId = node.operatorToken.kind;
                if (primopId === SyntaxKind.BarBarToken
                    || primopId === SyntaxKind.QuestionQuestionToken
                    || primopId === SyntaxKind.AmpersandAmpersandToken
                ) {
                    const lhsRes = fixed_eval(Config({ node: node.left, env }));
                    const rhsRes = fixed_eval(Config({ node: node.right, env }));
                    return join(lhsRes, rhsRes);
                } else if (primopId === SyntaxKind.PlusToken
                    || primopId === SyntaxKind.AsteriskToken
                    || primopId === SyntaxKind.SlashToken
                    || primopId === SyntaxKind.PercentToken
                    || primopId === SyntaxKind.EqualsEqualsEqualsToken
                    || primopId === SyntaxKind.ExclamationEqualsEqualsToken
                ) {
                    return singleConfig(config);
                } else {
                    return unimplementedBottom(`Unimplemented binary expression ${printNodeAndPos(node)}`);
                }
            } else if (isTemplateExpression(node)) {
                return singleConfig(config);
            } else if (isConditionalExpression(node)) {
                const thenValue = fixed_eval(Config({ node: node.whenTrue, env }));
                const elseValue = fixed_eval(Config({ node: node.whenFalse, env }));
                return join(thenValue, elseValue)
            } else if (isAsExpression(node)) {
                return fixed_eval(Config({ node: node.expression, env }));
            } else if (node.kind === SyntaxKind.AsyncKeyword) {
                return singleConfig(config);
            } else if (isClassDeclaration(node)) {
                return singleConfig(config);
            } else if (isArgumentList(node)) {
                return singleConfig(config)
            } else if (isElementPick(node)) {
                return singleConfig(config);
            } else if (isFunctionDeclaration(node)) { // if we're here, this is an overload declaration
                return empty();
            } else if (ts.isEnumDeclaration(node)) {
                return singleConfig(config);
            } else if (ts.isNonNullExpression(node)) {
                return fixed_eval(Config({ node: node.expression, env }))
            }
            return unimplementedBottom(`abstractEval not yet implemented for: ${AnalysisSyntaxKind[node.kind]}:${getPosText(node)}`);
        }
    }
    
    // "expr"
    function getWhereValueApplied(config: Config, fix_run: FixRunFunc<Config, ConfigSet>, push_cache: DcfaCachePusher): ConfigSet {
        return join(
            getWhereValueOfCurrentConfigApplied(),
            setFlatMap(getRefinementsOf(config, fix_run), refinedConfig => fix_run(getWhereValueApplied, refinedConfig))
        )

        function getWhereValueOfCurrentConfigApplied() {
            const operatorSites = configSetFilter(
                getWhereValueReturned(config, fix_run, push_cache),
                funcConfig => {
                    if (!ts.isCallExpression(funcConfig.node.parent)) {
                        return false;
                    }
                    if (isOperatorOf(funcConfig.node, funcConfig.node.parent)) {
                        return true;
                    }
                    const operatorConses = fix_run(abstractEval, Config({ node: funcConfig.node.parent.expression, env: funcConfig.env }));
                    return setSome(operatorConses, (cons) => isConfigExtern(cons) || isBuiltInConstructorShapedConfig(cons));
                }
            );
            return configSetMap(operatorSites, config => Config({ node: config.node.parent, env: config.env }));
        }
    }

    function getWhereValueReturned(config: Config, fix_run: FixRunFunc<Config, ConfigSet>, push_cache: DcfaCachePusher): ConfigSet {
        if (!isExtern(config.node) && sourceFileOf(config.node).fileName.includes('.test.ts')) {
            return empty();
        }

        return join(
            join(singleConfig(config), getWhereValueReturnedElsewhere(config, fix_run, push_cache)),
            setFlatMap(getRefinementsOf(config, fix_run), refinedConfig => fix_run(getWhereValueReturned, refinedConfig))
        );
    }

    function getWhereValueReturnedElsewhere(config: Config, fix_run: FixRunFunc<Config, ConfigSet>, push_cache: DcfaCachePusher): ConfigSet {
        const fixed_eval = (config: Config) => fix_run(abstractEval, config);
        const fixed_trace = (config: Config) => fix_run(getWhereValueReturned, config);

        const { node, env } = config;
        if (isExtern(node)) {
            return empty();
        }

        const parent = node.parent;
        if (ts.isCallExpression(parent)) {
            if (isOperatorOf(node, parent)) {
                return empty(); // If we're the operator, our value doesn't get propogated anywhere
            } else if (isPrismaQuery(parent)) {
                return empty();
            } else {
                return getWhereReturnedInsideFunction(Config({ node: parent, env }), node, (parameterName, opEnv) =>
                    ts.isIdentifier(parameterName) 
                        ? getReferences(Config({ node: parameterName, env: opEnv.push(pushContext(parent, env, m)) }))
                        : empty() // If it's not an identifier, it's being destructured, so the value doesn't continue on
                );
            }
        } else if (isFunctionLikeDeclaration(parent) && isBodyOf(node, parent)) {
            const closedOverSites = fix_run(getWhereClosed, config);
            const transitiveSites = configSetJoinMap(closedOverSites, site => fix_run(getWhereValueReturned, site));

            if (!isAsync(parent)) {
                return transitiveSites;
            } else {
                const sitesWhereAwaited = configSetFilter(transitiveSites, site => ts.isAwaitExpression(site.node.parent));
                return configSetMap(sitesWhereAwaited, site => Config({ node: site.node.parent, env: site.env }))
            }
        } else if (ts.isParenthesizedExpression(parent)) {
            return fix_run(getWhereValueReturned, Config({ node: parent, env }));
        } else if (ts.isVariableDeclaration(parent)) {
            if (!ts.isIdentifier(parent.name)) {
                return empty(); // if it's not an identifier, we're destructuring it, which will return different values
            }

            const refs = getReferences(Config({ node: parent.name, env }))
            return configSetJoinMap(refs, ref => fix_run(getWhereValueReturned, ref));
        } else if (isFunctionDeclaration(node) || isClassDeclaration(node) || isEnumDeclaration(node)) { // note that this is a little weird since we're not looking at the parent
            if (node.name === undefined) {
                return unimplementedBottom('function/class/enum declaration should have name')
            }

            const refs = getReferences(Config({ node: node.name, env }));
            return configSetJoinMap(refs, ref => fix_run(getWhereValueReturned, ref));
        } else if (ts.isForOfStatement(parent) && parent.expression === node) {
            return empty(); // we're effectively "destructuring" the expression here, so the original value is gone
        } else if (ts.isPropertyAccessExpression(parent)) {
            if (node == parent.name) {
                return unimplementedBottom(`Unknown situation: tracing a property access's name: ${printNodeAndPos(parent)}`)
            }

            return empty();
        } else if (ts.isShorthandPropertyAssignment(parent)) {
            return getWherePropertyReturned(Config({ node: parent.parent, env }), parent.name);
        } else if (ts.isImportSpecifier(parent)) {
            return getReferences(Config({ node: parent.name, env }));
        } else if (ts.isPropertySignature(parent)) {
            return empty(); // spurious reference
        } else if (ts.isClassDeclaration(parent) && isMethodDeclaration(node)) {
            if (node.name === undefined || !ts.isIdentifier(node.name)) {
                return unimplementedBottom('method declaration should have name')
            }

            const refs = getReferences(Config({ node: node.name, env }));
            const propertyAccessesAtRefs = configSetJoinMap<AnalysisNode>(refs, ref => {
                if (ts.isMethodSignature(ref.node.parent)) {
                    return empty();
                }

                if (!ts.isPropertyAccessExpression(ref.node.parent) || ref.node.parent.name !== ref.node) {
                    return unimplementedBottom(`Expected ref to be the name of a property access expression ${printNodeAndPos(ref.node)}`);
                }

                return singleConfig(Config({ node: ref.node.parent, env: ref.env }));
            })
            return configSetJoinMap(propertyAccessesAtRefs, ref => fix_run(getWhereValueReturned, ref));
        } else if (isOnLhsOfAssignmentExpression(config.node)) {
            return empty();
        } else if (ts.isPropertyAssignment(parent)) {
            const propName = parent.name;
            if (!ts.isIdentifier(propName)) {
                return unimplementedBottom(`Unimplemented property name type: ${printNodeAndPos(propName)}`);
            }
            return getWherePropertyReturned(Config({ node: parent.parent, env }), propName)
        } else if (ts.isReturnStatement(parent)) {
            const functionBlock = getFunctionBlockOf(parent);
            return fixed_trace(Config({ node: functionBlock, env }));
        } else if (ts.isTypeQueryNode(parent)) {
            return empty();
        } else if (ts.isAsExpression(parent)) {
            return fixed_trace(Config({ node: parent, env }));
        } else if (ts.isAwaitExpression(parent)) {
            return empty();
        } else if (ts.isBinaryExpression(parent)
            && (parent.operatorToken.kind === SyntaxKind.BarBarToken
                || parent.operatorToken.kind === SyntaxKind.QuestionQuestionToken
                || parent.operatorToken.kind === SyntaxKind.AmpersandAmpersandToken
            )
        ) {
            return fixed_trace(Config({ node: parent, env }));
        }else if (ts.isBinaryExpression(parent)
            && (parent.operatorToken.kind === SyntaxKind.EqualsEqualsEqualsToken
                || parent.operatorToken.kind === SyntaxKind.PlusToken
            )
        ) {
            return empty();
        } else if (ts.isSpreadElement(parent)) {
            return empty();
        } else if (isAssignmentExpression(parent) && parent.right === node) {
            return fixed_trace(Config({ node: parent.left, env }));
        } else if (ts.isConditionalExpression(parent)) {
            return fixed_trace(Config({ node: parent, env }));
        } else if (ts.isTemplateSpan(parent)) {
            return empty()
        } else if (ts.isExpressionStatement(parent)) {
            return empty();
        } else if (ts.isElementAccessExpression(parent)) {
            return empty();
        } else if (ts.isClassDeclaration(parent) && (isDecorator(node))) {
            return empty(); // assumption: we're not mutating injectable services
        } else if (ts.isPrefixUnaryExpression(parent)) {
            return empty();
        } else if (ts.isTypeReferenceNode(parent)) {
            return empty();
        } else if (ts.isNewExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === 'PortfolioChangedEvent') {
            return empty(); // special case, since PortfolioChangedEvent doesn't have any mutable fields
        } else if (ts.isSpreadAssignment(parent)) {
            return empty();
        } else if (ts.isQualifiedName(parent)) {
            return empty();
        } else if (ts.isArrayLiteralExpression(parent)) {
            const parentArraySites = fixed_trace(Config({ node: parent, env }));
            const parentArrayParents = configSetMap(parentArraySites, parentObject => Config({ node: parentObject.node.parent, env: parentObject.env }));
            const parentObjectElementAccesses = setFilter(parentArrayParents, isElementAccessConfig);

            const parentArrayAsInitializer = setFilter(
                setFilter(parentArrayParents, isVariableDeclarationConfig),
                declaration => ts.isArrayBindingPattern(declaration.node.name)
            );
            const parentArrayAsArgument = setFilter(parentArraySites, parentArray =>
                isConfigNoExtern(parentArray)
                && ts.isCallExpression(parentArray.node.parent)
                && parentArray.node.parent.expression !== parentArray.node
            );
            if (parentArrayAsInitializer.size > 0 || parentArrayAsArgument.size > 0) {
                return unimplementedBottom(`Unknown situation: tracing a parent array through a variable declaration or call: ${printNodeAndPos(parent)}`)
            }
            return parentObjectElementAccesses;
        } else if (isImportSpecifier(node)) {
            return getReferences(Config({ node: node.name, env }))
        } else if (isFunctionLikeDeclaration(parent) && isParameter(node)) {
            return empty() // covered by the first case
        } else if (ts.isPropertyDeclaration(parent)) {
            if (!isPrivate(parent)) {
                return unimplementedBottom(`Unknown kind of property declaration: ${printNodeAndPos(parent)}`);
            }
            const identifier = parent.name;
            if  (!isIdentifier(identifier)) {
                return unimplementedBottom(`Unknown kind of property declaration: ${printNodeAndPos(parent)}`);
            }

            const classDeclaration = parent.parent;
            const accesses = findAll(classDeclaration, descendant => ts.isPropertyAccessExpression(descendant)
                && descendant.expression.kind === SyntaxKind.ThisKeyword
                && descendant.name.text === identifier.text
            );
            return Set(accesses).map(withUnknownContext)
        } else if (isFunctionLikeDeclaration(parent) && isAsyncKeyword(node)) {
            const closedOverSites = fix_run(getWhereClosed, Config({ node: parent.body, env }));
            const transitiveSites = configSetJoinMap(closedOverSites, site => fix_run(getWhereValueReturned, site));
            return transitiveSites;
        } else if (ts.isExportSpecifier(parent)) {
            return empty(); // standard reference finding is transitive by default
        } else if (ts.isNewExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === 'URLSearchParams') {
            return empty();
        } else if (ts.isEnumMember(parent)) {
            const name = parent.name
            if (!ts.isIdentifier(name)) {
                return unimplementedBottom(`Expected identifier as name of enum member: ${printNodeAndPos(parent)}`)
            }

            const enumSites = fixed_trace(Config({ node: parent.parent, env }));
            const enumSiteParents = configSetMap(enumSites, site => Config({ node: site.node.parent, env: site.env}));
            const enumAccesses = enumSiteParents.filter(isPropertyAccessConfig);
            const enumAccessesWithMatchingName = enumAccesses.filter(access => access.node.name.text === name.text);
            return enumAccessesWithMatchingName
        } else if (ts.isIfStatement(parent) && parent.expression === node) {
            return empty();
        } else if (ts.isImportClause(parent)) {
            return empty();
        } else if (ts.isExportAssignment(parent)) {
            return empty(); // covered by other kinds of declarations finding references
        }
        return unimplementedBottom(`Unknown kind for getWhereValueReturned: ${printNodeAndPos(parent)}`);

        function getWherePropertyReturned(parentObjectConfig: Config, name: ts.Identifier) {
            const parentObjectSites = fixed_trace(Config({ node: parentObjectConfig.node, env: parentObjectConfig.env }));
            const parentObjectsParents = configSetMap(parentObjectSites, parentObject => Config({ node: parentObject.node.parent, env: parentObject.env }));

            const parentObjectPropertyAccesses = setFilter(parentObjectsParents, isPropertyAccessConfig);
            const parentObjectPropertyAccessesWithMatchingName = setFilter(parentObjectPropertyAccesses, access => access.node.name.text === name.text);

            const parentObjectElementAccesses = setFilter(parentObjectsParents, isElementAccessConfig);
            const parentObjectElementAccessesWithMatchingName = setFilter(parentObjectElementAccesses, access => {
                const indexConses = fixed_eval(Config({ node: access.node.argumentExpression, env: access.env }));
                return setSome(indexConses, cons => subsumes(cons.node, name));
            })

            const parentObjectSpreads = setFilter(parentObjectsParents, isSpreadAssignmentConfig);
            const parentObjectSpreadTo = setFlatMap(parentObjectSpreads, spread => fixed_eval(Config({ node: spread.node.parent, env: spread.env })));
            const propertyReturnedFromSpreadToObject = configSetJoinMap(parentObjectSpreadTo, site => getWherePropertyReturned(site, name));

            const parentObjectAsInitializer = setFilter(parentObjectsParents, isVariableDeclarationConfig);
            const matchingNames = configSetJoinMap(parentObjectAsInitializer, declaration => {
                if (!ts.isObjectBindingPattern(declaration.node.name)) {
                    return empty();
                }
                const matchingName = declaration.node.name.elements.find(elem => ts.isIdentifier(elem.name) && elem.name.text === name.text);
                if (matchingName === undefined) {
                    return empty();
                }
                return singleConfig(Config({ node: matchingName, env: declaration.env }));
            });

            const propertyReturnedInFunctionAt = configSetJoinMap(parentObjectSites, returnLocConfig => {
                const { node: returnLoc, env: returnLocEnv } = returnLocConfig;
                const returnLocParent = returnLoc.parent;
                if (ts.isCallExpression(returnLocParent) && !isOperatorOf(returnLoc, returnLocParent)) {
                    if (isPrismaQuery(returnLocParent)) {
                        return empty();
                    }

                    return getWhereReturnedInsideFunction(
                        Config({ node: returnLocParent, env: returnLocEnv }),
                        returnLoc,
                        (parameterName, opEnv) => {
                            if (!ts.isObjectBindingPattern(parameterName)) {
                                return empty();
                            }
                            const destructedName = parameterName.elements.find(elem => 
                                ts.isIdentifier(elem.name)
                                    ? elem.name.text === name.text
                                    : unimplemented(`Nested binding patterns unimplemented: ${printNodeAndPos(elem)}`, empty())
                            )?.name;
                            if (destructedName === undefined) {
                                return unimplemented(`Unable to find destructed identifier in ${printNodeAndPos(parameterName)}`, empty())
                            }
                            if (!ts.isIdentifier(destructedName)) {
                                return unimplemented(`Expected a simple binding name ${printNodeAndPos(destructedName)}`, empty())
                            }

                            return getReferences(Config({
                                node: destructedName,
                                env: opEnv.push(pushContext(returnLocParent, returnLocEnv, m)),
                            }));
                        }
                    )
                }
                return empty();
            });

            return joinAll(
                parentObjectPropertyAccessesWithMatchingName,
                parentObjectElementAccessesWithMatchingName,
                propertyReturnedInFunctionAt,
                propertyReturnedFromSpreadToObject,
                matchingNames,
            );
        }

        function getWhereReturnedInsideFunction(parentConfig: Config<ts.CallExpression>, node: AnalysisNode, getReferencesFromParameter: (name: ts.BindingName, opEnv: Environment) => ConfigSet) {
            const parent = parentConfig.node;
            const argIndex = getArgumentIndex(parent, node);
            const possibleOperators = fixed_eval(Config({ node: parent.expression, env: parentConfig.env }));

            const possibleFunctions = setFilter(possibleOperators, isFunctionLikeDeclarationConfig);
            const parameterReferences = configSetJoinMap<SimpleFunctionLikeDeclaration>(
                possibleFunctions,
                (funcConfig) => {
                    push_cache(
                        envKey(funcConfig.env.push(newQuestion(funcConfig.node))),
                        envValue(funcConfig.env.push(pushContext(parent, parentConfig.env, m)))
                    );
                    const parameterName = funcConfig.node.parameters[argIndex].name;
                    const refs = getReferencesFromParameter(parameterName, funcConfig.env);
                    return configSetJoinMap(refs, ref => fix_run(getWhereValueReturned, ref));
                }
            );
            return configSetJoinMap(parameterReferences, (parameterRef) => fix_run(getWhereValueReturned, parameterRef));
        }
    }
    
    // "call"
    function getWhereClosed(config: Config, fix_run: FixRunFunc<Config, ConfigSet>, push_cache: DcfaCachePusher): ConfigSet {
        return join(
            getWhereCurrentConfigClosed(),
            setFlatMap(getRefinementsOf(config, fix_run), refinedConfig => fix_run(getWhereClosed, refinedConfig))
        )

        function getWhereCurrentConfigClosed(): ConfigSet {
            const { node, env } = config;
            if (isExtern(node)) {
                return empty();
            }
            
            if (!isFunctionLikeDeclaration(node.parent) || !isConciseBody(node)) {
                return unimplementedBottom(`Trying to find closure locations for ${SyntaxKind[node.kind]}`);
            }

            const applicationSites = fix_run(getWhereValueApplied, Config({ node: node.parent, env: env.pop() }));
    
            return configSetFilter(applicationSites, siteConfig => {
                const site = siteConfig.node;
                if (!isCallExpression(site)) {
                    return unimplemented(`Got non-callsite from getWhereValueApplied: ${printNodeAndPos(site)}`, false);
                }

                const contextFromCallSite = pushContext(site, siteConfig.env, m);

                if (refines(contextFromCallSite, env.last()!)) {
                    push_cache(envKey(env), envValue(env.pop().push(contextFromCallSite)));
                }

                return Immutable.is(contextFromCallSite, env.last()!);
            });
        }
    }
    
    // "find"
    function getReferences(idConfig: Config<ts.Identifier>): ConfigSet<ts.Node> {
        const { node: id, env: idEnv } = idConfig;
        const symbol = typeChecker.getSymbolAtLocation(id)

        return computeReferences()

        function computeReferences(): ConfigSet<ts.Node> {
            const declaration = symbol?.valueDeclaration
                ?? symbol?.declarations?.[0];
            if (declaration === undefined) {
                throw new Error(`Could not find declaration for ${printNodeAndPos(id)}`);
            }
            
            if (declaration.getSourceFile().isDeclarationFile || ts.isNamespaceImport(declaration)) {
                return empty();
            }

            const scope = getDeclaringScope(declaration, typeChecker);
            const envAtDeclaringScope = shortenEnvironmentToScope(idConfig, scope);

            const refs = service
                .findReferences(id.getSourceFile().fileName, id.getStart())
                ?.flatMap(ref => ref.references)
                ?.filter(ref => !ref.isDefinition)
                ?.filter(ref => !ref.fileName.includes('.test.ts'));
            if (refs === undefined) {
                return unimplemented('undefined references', empty());
            }
            const refNodes = refs
                .map(ref => getNodeAtPosition(
                    program.getSourceFile(ref.fileName)!,
                    ref.textSpan!.start,
                    ref.textSpan!.length,
                )!)
                .filter(refNode => {
                    if (!ts.isIdentifier(refNode)) {
                        // some definitions seems to be slipping though. Filter them out here.
                        return false;
                    }

                    const refSymbol = typeChecker.getSymbolAtLocation(refNode);
                    const refDeclaration = refSymbol?.valueDeclaration
                        ?? refSymbol?.declarations?.[0];

                    return refDeclaration === declaration;
                });
            const refNodeConfigs: Config<ts.Node>[] = refNodes.flatMap(refNode => {
                if (refNode.getSourceFile().isDeclarationFile) {
                    return [];
                }

                const parents = getParentChain(refNode);
                const bindersForEnvOfRef: SimpleFunctionLikeDeclaration[] = [];
                let foundScope = false;
                for (const parent of parents) {
                    if (parent === scope) {
                        foundScope = true;
                        break;
                    }
                    if (isFunctionLikeDeclaration(parent)) {
                        bindersForEnvOfRef.push(parent);
                    }
                }
                // Sometimes the TypeScript compiler gives us spurious references for reasons I
                // don't fully understand. My hypothesis that all of these false positives will
                // be in the same file, but in a different branch of the AST.
                // Might be able to get rid of this now since we're filtering on property
                if (!foundScope && refNode.getSourceFile() === id.getSourceFile()) {
                    return [];
                }

                const refEnv = bindersForEnvOfRef.reverse().reduce((env, binder) => env.push(newQuestion(binder)), envAtDeclaringScope);

                // sanity check
                if (refEnv.count() != withUnknownContext(refNode).env.count()) {
                    return unimplemented(`Incorrect environment produced for ref ${printNodeAndPos(refNode)}`, [])
                }

                return [Config({
                    node: refNode,
                    env: refEnv,
                })]
            });
            return Set.of(...refNodeConfigs);
        }
    }
    
    // "bind"
    function getBoundExprs(idConfig: Config<ts.Identifier>, fix_run: FixRunFunc<Config, ConfigSet>): ConfigSet {
        const { node: id } = idConfig;
        if (id.text === 'undefined') {
            return empty();
        }

        const symbol = typeChecker.getSymbolAtLocation(id);
        if (symbol === undefined) {
            return unimplemented(`Unable to find symbol ${id.text}`, empty())
        }

        if ((symbol.valueDeclaration?.flags ?? symbol.declarations?.[0]?.flags ?? 0) & Ambient) { // it seems like this happens with built in ids like `Date`
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
        if (declaration.getSourceFile().isDeclarationFile) {
            return justExtern;
        }

        const declaringScope = getDeclaringScope(declaration, typeChecker);
        const envAtDeclaringScope = shortenEnvironmentToScope(idConfig, declaringScope);

        return join(getBindingsFromDelcaration(declaration), getBindingsFromMutatingAssignments());

        function getBindingsFromMutatingAssignments(): ConfigSet {
            const refs = getReferences(idConfig).filter(ref => typeChecker.getSymbolAtLocation(ref.node) === symbol);
            const refParents = configSetMap(refs, ref => Config({ node: ref.node.parent, env: ref.env }));
            const refAssignments = refParents.filter(isAssignmentExpressionConfig);
            return setFlatMap(refAssignments, assignmentExpression => {
                if (assignmentExpression.node.operatorToken.kind !== SyntaxKind.EqualsToken) {
                    return unimplementedBottom(`Unknown assignment operator kind: ${printNodeAndPos(assignmentExpression.node.operatorToken)}`);
                }

                return singleConfig(Config({ node: assignmentExpression.node.right, env: assignmentExpression.env }));
            })
        }

        function getBindingsFromDelcaration(declaration: ts.Declaration): ConfigSet {
            if (ts.isParameter(declaration)) {
                if (declaration.parent === targetFunction) {
                    return justExtern
                }

                return getArgumentsForParameter(declaration, envAtDeclaringScope);
            } else if (ts.isVariableDeclaration(declaration)) {
                if (ts.isForOfStatement(declaration.parent.parent)) {
                    const forOfStatement = declaration.parent.parent;
                    const expression = forOfStatement.expression;
    
                    return getElementNodesOfArrayValuedNode(
                        Config({ node: expression, env: envAtDeclaringScope }),
                        { fixed_eval, fixed_trace, m }
                    );
                } else if (ts.isCatchClause(declaration.parent)) {
                    const tryBlock = declaration.parent.parent.tryBlock;
                    const reachableBlocks = getReachableBlocks(Config({ node: tryBlock, env: envAtDeclaringScope }), m, fixed_eval, fixed_trace, push_cache);
                    const thrownNodeConfigs = setFlatMap(reachableBlocks, setOf(blockConfig => {
                        const throwStatements = getThrowStatements(blockConfig.node);
                        return [...throwStatements].map(throwStatement => ({
                            node: throwStatement.expression,
                            env: blockConfig.env,
                        } as Config<ts.Expression>));
                    }));
                    // the `justExtern` here is a bit of an overapproximation, but it's pretty
                    // likely that *something* in the catch block could throw an exception that
                    // isn't syntactically represented
                    return join(thrownNodeConfigs, justExtern); 
                } else { // it's a standard variable delcaration
                    if (declaration.initializer === undefined) {
                        return empty();
                    }
        
                    return singleConfig(Config({
                        node: declaration.initializer,
                        env: envAtDeclaringScope,
                    }));
                }
            } else if (ts.isFunctionDeclaration(declaration) || ts.isClassDeclaration(declaration) || ts.isEnumDeclaration(declaration)) {
                return singleConfig(Config({
                    node: declaration,
                    env: envAtDeclaringScope,
                }));
            } else if (ts.isBindingElement(declaration)) {
                const bindingElementSource = declaration.parent.parent;
                if (ts.isVariableDeclaration(bindingElementSource)) {
                    if (ts.isForOfStatement(bindingElementSource.parent.parent)) {
                        const expression = bindingElementSource.parent.parent.expression;
                        if (ts.isArrayBindingPattern(declaration.parent)) {
                            if (!ts.isIdentifier(declaration.name)) {
                                return unimplementedBottom(`Expected name to be an identifier ${printNodeAndPos(declaration.name)}`)
                            }

                            const i = declaration.parent.elements.indexOf(declaration);
                            return getElementOfArrayOfTuples(
                                Config({ node: expression, env: idConfig.env }), i,
                                fixed_eval, fixed_trace, m
                            );
                        }
                    }

                    const initializer = bindingElementSource.initializer;
                    if (initializer === undefined) {
                        return empty();
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
    
                    if (ts.isObjectBindingPattern(declaration.parent)) {
                        const objectConsConfigs = fixed_eval(Config({ node: initializer, env: envAtDeclaringScope }));
                        return getObjectsPropertyInitializers(objectConsConfigs, symbol.name);
                    } else if (ts.isArrayBindingPattern(declaration.parent)) {
                        const i = declaration.parent.elements.indexOf(declaration);
                        if (ts.isAwaitExpression(initializer)) {
                            const consesOfExpressionOfAwait = fixed_eval(Config({ node: initializer.expression, env: envAtDeclaringScope }));
                            return configSetJoinMap(consesOfExpressionOfAwait, awaitExpressionCons => {
                                if (!isBuiltInConstructorShapedConfig(awaitExpressionCons)
                                    || getBuiltInValueOfBuiltInConstructor(awaitExpressionCons, fixed_eval) !== 'Promise.all()'
                                ) {
                                    return unimplementedBottom(`Tuple destructuring not yet implemented for anything but Promise.all ${printNodeAndPos(awaitExpressionCons.node)}`)
                                }
                                if (!isCallExpression(awaitExpressionCons.node)) {
                                    return unimplementedBottom(`Expected call expression ${printNodeAndPos(awaitExpressionCons.node)}`);
                                }

                                const tupleConfig = Config({ node: awaitExpressionCons.node.arguments[0], env: awaitExpressionCons.env });
                                const tupleElementResults = getElementOfTuple(tupleConfig, i, fixed_eval, fixed_trace);
                                return configSetJoinMap(tupleElementResults, tupleElementCons => resolvePromisesOfNode(tupleElementCons, fixed_eval))
                            })
                        } else {
                            const initializerConses = fixed_eval(Config({ node: initializer, env: envAtDeclaringScope }));
                            return configSetJoinMap(initializerConses, _ => unimplementedBottom(`Unknown tuple destructuring ${printNodeAndPos(initializer)}`)) // right now this only handles extern nodes
                        }
                    }
                } else if (ts.isParameter(bindingElementSource)) {
                    if (bindingElementSource.parent === targetFunction) {
                        return justExtern
                    }
                    const argConfigs = getArgumentsForParameter(bindingElementSource, envAtDeclaringScope);
                    
                    const argsValues = configSetJoinMap(argConfigs, argConfig => fix_run(abstractEval, argConfig));

                    if (ts.isObjectBindingPattern(declaration.parent)) {
                        return getObjectsPropertyInitializers(argsValues, symbol.name);
                    } else if (ts.isArrayBindingPattern(declaration.parent)) {
                        const i = declaration.parent.elements.indexOf(declaration);
                        return configSetJoinMap(argsValues, argCons => {
                            return getElementOfTuple(argCons, i, fixed_eval, fixed_trace)
                        })
                    }
                }
            } else if (ts.isImportClause(declaration) || ts.isImportSpecifier(declaration) || ts.isNamespaceImport(declaration)) {
                const moduleSpecifier = getModuleSpecifier(declaration);
    
                if (!ts.isStringLiteral(moduleSpecifier)) {
                    throw new Error('Module specifier must be a string literal');
                }
    
                const aliasedSymbol = typeChecker.getAliasedSymbol(symbol);
                if (aliasedSymbol.flags & Ambient || aliasedSymbol.valueDeclaration?.getSourceFile().isDeclarationFile) {
                    return justExtern;
                }

                return getBoundExprsOfSymbol(aliasedSymbol, idConfig, fix_run);
            } else if (ts.isShorthandPropertyAssignment(declaration)) {
                const shorthandValueSymbol = typeChecker.getShorthandAssignmentValueSymbol(declaration);
                if (shorthandValueSymbol === undefined) {
                    throw new Error(`Should have gotten value symbol for shortand assignment: ${symbol.name} @ ${getPosText(declaration)}`)
                }
                return getBoundExprsOfSymbol(shorthandValueSymbol, idConfig, fix_run);
            }
            return unimplementedBottom(`getBoundExprs not yet implemented for ${ts.SyntaxKind[declaration.kind]}:${getPosText(declaration)}`);
        }

        function getArgumentsForParameter(declaration: ParameterDeclaration, envAtDeclaredScope: Environment): ConfigSet {
            const declaringFunction = declaration.parent;
            if (!isFunctionLikeDeclaration(declaringFunction)) {
                return unimplementedBottom('not yet implemented');
            }
            const parameterIndex = declaringFunction.parameters.indexOf(declaration);
            const declaringFunctionBody = declaringFunction.body
    
            const definingFunctionCallSites = fix_run(
                getWhereClosed, Config({ node: declaringFunctionBody, env: envAtDeclaredScope })
            );
            const argBindings =  setFlatMap(definingFunctionCallSites, (callSite) => {
                if (!isCallConfig(callSite)) {
                    return unimplementedBottom(`Expected call site ${printNodeAndPos(callSite.node)}`)
                }

                const opConses = fixed_eval(Config({ node: callSite.node.expression, env: callSite.env }));
                let bindings = Set<Config>()
                if (setSome(opConses, opCons => opCons.node === declaringFunction)) {
                    if (declaration.dotDotDotToken === undefined) {
                        if (callSite.node.arguments[parameterIndex]) {
                            bindings = bindings.union(fixed_eval(Config({
                                node: callSite.node.arguments[parameterIndex],
                                env: callSite.env
                            })))
                        } else {
                            if (declaration.initializer === undefined) {
                                return unimplementedBottom(`Expected a default initializer ${printNodeAndPos(callSite.node)}`)
                            }

                            bindings = bindings.add(Config({
                                node: declaration.initializer,
                                env: envAtDeclaredScope,
                            }));
                        }
                    } else {
                        bindings = bindings.add(Config({
                            node: createArgumentList(callSite.node, parameterIndex),
                            env: callSite.env
                        }));
                    }
                }
                if (setSome(opConses, isConfigExtern)) {
                    bindings = bindings.union(justExtern);
                }
                if (setSome(opConses, isBuiltInConstructorShapedConfig)) {
                    const builtInConses = setFilter(opConses, isBuiltInConstructorShapedConfig);
                    bindings = bindings.union(configSetJoinMap(builtInConses, config => {
                        const builtInValue = getBuiltInValueOfBuiltInConstructor(config, fixed_eval);
                        const binderGetter = builtInValueBehaviors[builtInValue].primopBinderGetter;
                        const argParameterIndex = declaration.parent.parameters.indexOf(declaration);
                        const primopArgIndex = callSite.node.arguments.findIndex(arg =>
                            setSome(fixed_eval(Config({ node: arg, env: callSite.env })), argCons => argCons.node === declaringFunction)
                        );
                        const thisConfig = ts.isPropertyAccessExpression(callSite.node.expression)
                            ? Config({
                                node: callSite.node.expression.expression,
                                env: callSite.env
                            })
                            : undefined;
                        return binderGetter.apply(
                            thisConfig, [primopArgIndex, argParameterIndex, callSite,
                            { fixed_eval, fixed_trace, m }]
                        );
                    }))
                }
                return bindings;
            });

            // const sitesWhereDeclaringFunctionReturned = fixed_trace(Config({ node: declaringFunction, env: envAtDeclaredScope.pop() }));
            // const boundFromPrimop = configSetJoinMap(
            //     sitesWhereDeclaringFunctionReturned,
            //     (config) => {
            //         const { node, env: callSiteEnv } = config;
            //         const callSiteWhereArg = node.parent;
            //         if (!ts.isCallExpression(callSiteWhereArg)) {
            //             return empty();
            //         }
            //         const consumerConfigsAndExterns = fixed_eval(Config({ node: callSiteWhereArg.expression, env: callSiteEnv }));
            //         const consumerConfigs = setFilter(consumerConfigsAndExterns, isConfigNoExtern);

            //         return setFlatMap(consumerConfigs, (config) => {
            //             if (!isBuiltInConstructorShapedConfig(config)) {
            //                 return empty();
            //             }

            //             const builtInValue = getBuiltInValueOfBuiltInConstructor(config, fixed_eval);
            //             const binderGetter = builtInValueBehaviors[builtInValue].primopBinderGetter;
            //             const argParameterIndex = declaration.parent.parameters.indexOf(declaration);
            //             const primopArgIndex = callSiteWhereArg.arguments.indexOf(node as Expression);
            //             const thisConfig = ts.isPropertyAccessExpression(callSiteWhereArg.expression)
            //                 ? Config({
            //                     node: callSiteWhereArg.expression.expression,
            //                     env: callSiteEnv
            //                 })
            //                 : undefined;
            //             return binderGetter.apply(
            //                 thisConfig, [primopArgIndex, argParameterIndex, Config({ node: callSiteWhereArg, env: callSiteEnv }),
            //                 { fixed_eval, fixed_trace, m }]
            //             );
            //         });
            //     }
            // );

            return argBindings;
        }
    }

    function getObjectsPropertyInitializers(objConstructorConfigs: ConfigSet, idName: string): ConfigSet {
        return configSetJoinMap(objConstructorConfigs, ({ node: objConstructor, env }) => {
            if (!isObjectLiteralExpression(objConstructor)) {
                return unimplemented(`Destructuring non-object literals not yet implemented: ${printNodeAndPos(objConstructor)}`, empty());
            }

            const initializer = getObjectPropertyInitializer(objConstructor as ObjectLiteralExpression, idName);
            
            return initializer !== undefined
                ? singleConfig(Config({ node: initializer, env}))
                : empty();
        });
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
        
function isOperatorOf(op: AnalysisNode, call: ts.CallExpression) {
    return op === call.expression;
}

function getArgumentIndex(call: ts.CallExpression, arg: AnalysisNode) {
    if (isArgumentList(arg)) {
        if (arg.arguments.first() === undefined) {
            return -1;
        }

        return call.arguments.indexOf(arg.arguments.first() as Expression)
    }

    return call.arguments.indexOf(arg as Expression);
}

function isBodyOf(node: AnalysisNode, func: SimpleFunctionLikeDeclaration) {
    return node === func.body;
}
