import ts, { SyntaxKind } from 'typescript';
import { FixedEval, FixedTrace } from './dcfa';
import { SimpleSet } from 'typescript-super-set';
import { structuralComparator } from './comparators';
import { empty, setFilter, setFlatMap, setMap, setSift, setSome, singleton } from './setUtil';
import { unimplemented } from './util';
import { isArrayLiteralExpression, isAssignmentExpression, isAsyncKeyword, isCallExpression, isClassDeclaration, isElementAccessExpression, isFunctionLikeDeclaration, isIdentifier, isNewExpression, isObjectLiteralExpression, isPropertyAccessExpression, isSpreadElement, isStatic, isStringLiteral, printNodeAndPos, SimpleFunctionLikeDeclaration } from './ts-utils';
import { Config, ConfigSet, configSetSome, singleConfig, isConfigNoExtern, configSetJoinMap, unimplementedBottom, ConfigNoExtern, configSetFilter, isObjectLiteralExpressionConfig, isConfigExtern, join, isAssignmentExpressionConfig, justExtern } from './configuration';
import { BuiltInProto, builtInValueBehaviors, getBuiltInValueOfBuiltInConstructor, getPropertyOfProto, getProtoOf, isBuiltInConstructorShapedConfig, isBuiltInProto } from './value-constructors';
import { getDependencyInjected, isDecoratorIndicatingDependencyInjectable, isThisAccessExpression } from './nestjs-dependency-injection';
import { AnalysisNode, createArgumentList, Cursor, isArgumentList, isElementPick, isExtern } from './abstract-values';
import { Set } from 'immutable'
import { Computation, FixRunFunc, makeFixpointComputer } from './fixpoint';


export function getObjectProperty(accessConfig: Config<ts.PropertyAccessExpression>, typeChecker: ts.TypeChecker, fixed_eval: FixedEval, fixed_trace: FixedTrace): ConfigSet {
    const { node: access, env } = accessConfig;
    if (access.name.text === '$transaction') {
        return justExtern; // assumption: there are no other "%transaction"s besides the prisma ones
    }
    const resultFromDepenencyInjection = isThisAccessExpression(access) && getDependencyInjected(Config({ node: access, env }), typeChecker, fixed_eval);
    if (resultFromDepenencyInjection) {
        return resultFromDepenencyInjection;
    }

    const expressionConses = fixed_eval(Config({ node: access.expression, env }));
    const property = access.name;
    return configSetJoinMap(expressionConses, consConfig => {
        return getPropertyFromObjectCons(consConfig, property, accessConfig, fixed_eval, fixed_trace);
    })
}

function nameMatches(lhs: ConfigNoExtern, name: ts.MemberName, fixed_eval: FixedEval): boolean {
    if (isPropertyAccessExpression(lhs.node)) {
        return lhs.node.name.text === name.text;
    } else if (isElementAccessExpression(lhs.node)) {
        const indexConses = fixed_eval(Config({ node: lhs.node.argumentExpression, env: lhs.env }));
        return indexConses.some(cons => subsumes(cons.node, name));
    }
    throw new Error(`Unknown left hand side: ${printNodeAndPos(lhs.node)}`)
}

function getPropertyFromObjectCons(consConfig: ConfigNoExtern, property: ts.MemberName, originalAccessConfig: Config<ts.PropertyAccessExpression> | undefined, fixed_eval: FixedEval, fixed_trace: FixedTrace): ConfigSet {
    return join(getPropertyFromSourceConstructor(), getPropertyFromMutations());

    function getPropertyFromMutations(): ConfigSet {
        if (consConfig.node.pos === 507
            && isNewExpression(consConfig.node)
            && isIdentifier(consConfig.node.expression)
            && consConfig.node.expression.text === 'Logger'
        ) {
            // Special case short circuit: Logger in trigger.dev is immutable but it goes *everywhere*, so this is the easiest way to deal with it.
            return empty();
        }

        // assumption: we're not going to be mutating an error that we threw
        if (ts.isThrowStatement(consConfig.node.parent)
            && isNewExpression(consConfig.node)
            && ts.isIdentifier(consConfig.node.expression)
            && consConfig.node.expression.text === 'Error'
        ) {
            return empty(); 
        } else if (ts.isNewExpression(consConfig.node.parent)
            && ts.isIdentifier(consConfig.node.parent.expression)
            && consConfig.node.parent.expression.text === 'Error'
        ) {
            return empty()
        }

        const tracedSites = setFilter(fixed_trace(consConfig), isConfigNoExtern);
        const refGrandparents = setMap(tracedSites, ref => Config({ node: ref.node.parent.parent, env: ref.env }));
        const refAssignments = setFilter(refGrandparents, isAssignmentExpressionConfig);
        const refAssignmentsWithMatching = setFilter(refAssignments, assignment => 
            nameMatches(
                Config({ node: assignment.node.left, env: assignment.env}), property, fixed_eval
            )
        );
        return setMap(refAssignmentsWithMatching, assignmentExpression => {
            if (assignmentExpression.node.operatorToken.kind !== SyntaxKind.EqualsToken) {
                return assignmentExpression;
            }

            return Config({ node: assignmentExpression.node.right, env: assignmentExpression.env });
        })
    }

    function getPropertyFromSourceConstructor() {
        const { node: cons, env: consEnv } = consConfig;
        if (isObjectLiteralExpression(cons)) {
            for (const prop of [...cons.properties].reverse()) {
                if (ts.isSpreadAssignment(prop)) {
                    const spreadConses = fixed_eval(Config({ node: prop.expression, env: consConfig.env }));
                    return configSetJoinMap(spreadConses, spreadCons =>
                        getPropertyFromObjectCons(spreadCons, property, originalAccessConfig, fixed_eval, fixed_trace)
                    );
                }
    
                if (prop.name === undefined || !ts.isIdentifier(prop.name)) {
                    console.warn(`Expected identifier for property`);
                    continue;
                }
    
                if (prop.name.text !== property.text) {
                    continue;
                }
    
                if (ts.isPropertyAssignment(prop)) {
                    return fixed_eval(Config({ node: prop.initializer, env: consEnv }));
                } else if (ts.isShorthandPropertyAssignment(prop)) {
                    return fixed_eval(Config({ node: prop.name, env: consEnv }))
                } else {
                    console.warn(`Unknown object property assignment`)
                }
            }
            return unimplementedBottom(`Unable to find object property ${printNodeAndPos(property)}`)
        } else if (isBuiltInConstructorShapedConfig(consConfig)) {
            if (originalAccessConfig === undefined) {
                return unimplementedBottom(`To access a built in constructor of an object, the original access must be defined: ${printNodeAndPos(cons)}`)
            }
    
            const builtInValue = getBuiltInValueOfBuiltInConstructor(consConfig, fixed_eval);
            return builtInValueBehaviors[builtInValue].resultOfPropertyAccess(originalAccessConfig, { fixed_eval });
        } else if (isDecoratorIndicatingDependencyInjectable(consConfig.node)) {
            const classDeclaration = consConfig.node.parent;
            if (!ts.isClassDeclaration(classDeclaration)) {
                return unimplementedBottom(`Expected ${printNodeAndPos(classDeclaration)} to be a class declaration`);
            }
    
            const reversedMembers = [...classDeclaration.members].reverse();
            for (const member of reversedMembers) {
                if (member.name !== undefined && ts.isIdentifier(member.name) && member.name.text === property.text) {
                    return singleConfig(Config({ node: member, env: consEnv }));
                }
            }
            return unimplementedBottom(`Unable to member ${printNodeAndPos(property)} in ${printNodeAndPos(classDeclaration)}`);
        } else if (isClassDeclaration(consConfig.node)) {
            const staticProperty = consConfig.node.members.find(member =>
                member.name !== undefined
                && ts.isIdentifier(member.name)
                && member.name.text === property.text
                && isFunctionLikeDeclaration(member)
                && isStatic(member)
            );
            if (staticProperty === undefined) {
                return unimplementedBottom(`Unable to find static property ${printNodeAndPos(property)} on class ${printNodeAndPos(consConfig.node)}`);
            }
            return singleConfig(Config({ node: staticProperty, env: consConfig.env }));
        } else if (isNewExpression(consConfig.node)) {
            const expressionConses = fixed_eval(Config({ node: consConfig.node.expression, env: consConfig.env }));
            const head = expressionConses.last();
            if (head != undefined
                && expressionConses.size === 1
                && isConfigNoExtern(head)
                && isIdentifier(head.node)
                && originalAccessConfig !== undefined
            ) {
                const nameText = head.node.text
                if (!isBuiltInProto(nameText)) {
                    return unimplementedBottom(`Unknown kind of identifier ${printNodeAndPos(head.node)}`)
                }

                return getPropertyOfProto(nameText, property.text, consConfig, originalAccessConfig, fixed_eval);
            }

            return configSetJoinMap(expressionConses, expressionCons => {
                if (isClassDeclaration(expressionCons.node)) {
                    const member = expressionCons.node.members.find(member => member.name !== undefined
                        && ts.isIdentifier(member.name)
                        && member.name.text === property.text
                    );
                    if (member === undefined) {
                        return unimplementedBottom(`Could not find member ${printNodeAndPos(property)} in ${printNodeAndPos(expressionCons.node)}`)
                    }
                    return singleConfig(Config({
                        node: member,
                        env: expressionCons.env
                    }));
                }

                return unimplementedBottom(`Unknown kind for new Expression ${printNodeAndPos(expressionCons.node)}`)
            });
        } else {
            if (originalAccessConfig === undefined) {
                return unimplementedBottom(`To access a proto constructor, the original access must be defined: ${printNodeAndPos(cons)}`)
            }
    
            const proto = getProtoOf(cons);
            if (proto === null) {
                return unimplementedBottom(`No constructors found for property access ${printNodeAndPos(originalAccessConfig.node)}`);
            }
            return getPropertyOfProto(proto, property.text, consConfig, originalAccessConfig, fixed_eval);
        }
    }
} 

export function getElementNodesOfArrayValuedNode(config: Config, { fixed_eval, fixed_trace, m }: { fixed_eval: FixedEval, fixed_trace: FixedTrace, m: number }): ConfigSet {
    return makeFixpointComputer<Config, ConfigSet>(empty<Config>(), join).valueOf(Computation({
        func: computeElements,
        args: config
    }))

    function computeElements(config: Config, fix_run: FixRunFunc<Config, ConfigSet>): ConfigSet {
        const conses = fixed_eval(config);
        return configSetJoinMap(conses, consConfig => {
            return join(fix_run(getElementVauesFromConstructor, consConfig), fix_run(getElementValuesFromMutations, consConfig));
    
        });
    }
    function getElementValuesFromMutations(consConfig: Config, fix_run: FixRunFunc<Config, ConfigSet>): ConfigSet {
        const sites = fixed_trace(consConfig);

        return configSetJoinMap(sites, site => {
            if (isPropertyAccessExpression(site.node.parent)) {
                if (site.node.parent.name.text === 'push') {
                    if (!isCallExpression(site.node.parent.parent)) {
                        return unimplementedBottom(`Expected a call to push ${printNodeAndPos(site.node.parent.parent)}`);
                    }
                    return Set(site.node.parent.parent.arguments).flatMap(arg => {
                        if (ts.isSpreadElement(arg)) {
                            return fix_run(computeElements, Config({ node: arg.expression, env: site.env}));
                        } else {
                            return singleConfig(Config({
                                node: arg,
                                env: site.env
                            }));
                        }
                    });
                }
            } else if (isElementAccessExpression(site.node)
                && isAssignmentExpression(site.node.parent)
                && site.node.parent.left === site.node
            ) {
                return singleConfig(Config({ node: site.node.parent.right, env: site.env }));
            }
            return empty();
        });
    }

    function getElementVauesFromConstructor(consConfig: Config, fix_run: FixRunFunc<Config, ConfigSet>): ConfigSet {
        const { node: cons, env: consEnv } = consConfig;
        if (isArrayLiteralExpression(cons)) {
            const elements = Set.of(...cons.elements.map(elem => Config({
                node: elem,
                env: consEnv,
            })));
            return configSetJoinMap(elements, elementConfig => {
                if (isSpreadElement(elementConfig.node)) {
                    const subElements = fix_run(computeElements, 
                        Config({ node: elementConfig.node.expression, env: elementConfig.env })
                    );
                    return subElements;
                }

                return singleConfig(elementConfig);
            })
        } else if (isArgumentList(cons)) {
            const elements = Set.of(...cons.arguments.map(elem => ({
                node: elem,
                env: consEnv,
            } as Config)));
            return configSetJoinMap(elements, elementConfig => {
                if (isSpreadElement(elementConfig.node)) {
                    const subElements = fix_run(computeElements,
                        Config({ node: elementConfig.node.expression, env: elementConfig.env })
                    );
                    return subElements;
                }

                return singleConfig(elementConfig);
            })
        } else if (isBuiltInConstructorShapedConfig(consConfig)) {
            const builtInValue = getBuiltInValueOfBuiltInConstructor(consConfig, fixed_eval)
            return builtInValueBehaviors[builtInValue].resultOfElementAccess(consConfig, { fixed_eval, fixed_trace, m });
        } else {
            return unimplemented(`Unable to access element of ${printNodeAndPos(cons)}`, empty());
        }
    }
}

// Arrays are sometimes used as tuples in JS. For it to make sense to treat an array as a tuple, it should never be mutated
// and it should be straightforward to find the ith element.
export function getElementOfArrayOfTuples(config: Config, i: number, fixed_eval: FixedEval, fixed_trace: FixedTrace, m: number) {
    const arrayConses = fixed_eval(config);
    return configSetJoinMap(arrayConses, arrayConsConfig => {

        const arrayElementNodes = getElementNodesOfArrayValuedNode(arrayConsConfig, { fixed_eval, fixed_trace, m });
        return configSetJoinMap(arrayElementNodes, tupleConfig => getElementOfTuple(tupleConfig, i, fixed_eval, fixed_trace));
    })
}

export function getElementOfTuple(tupleConfig: Config, i: number, fixed_eval: FixedEval, fixed_trace: FixedTrace) {
    const tupleConses = fixed_eval(tupleConfig);
    return configSetJoinMap(tupleConses, ({ node: tupleCons, env: tupleEnv }) => {
        if (isArrayLiteralExpression(tupleCons)) {
            return singleConfig(Config({
                node: tupleCons.elements[i],
                env: tupleEnv,
            }));
        } else if (isBuiltInConstructorShapedConfig(tupleConfig) && getBuiltInValueOfBuiltInConstructor(tupleConfig, fixed_eval) === 'Object.entries()[]') {
            if (!isElementPick(tupleConfig.node)) {
                return unimplementedBottom(`Expected an element pick ${printNodeAndPos(tupleConfig.node)}`);
            }

            const objectEntries = Config({ node: tupleConfig.node.expression, env: tupleConfig.env });
            if (!isBuiltInConstructorShapedConfig(objectEntries)
                || getBuiltInValueOfBuiltInConstructor(objectEntries, fixed_eval) !== 'Object.entries()'
                || !isCallExpression(objectEntries.node)
            ) {
                return unimplementedBottom(`Expected an Object.entries call`);
            }

            const objectReference = Config({ node: objectEntries.node.arguments[0], env: tupleConfig.env });
            const objectConses = fixed_eval(objectReference);
            const objectLiteralConses = configSetFilter(objectConses, isObjectLiteralExpressionConfig)
            return configSetJoinMap<ts.ObjectLiteralExpression>(objectLiteralConses, objectLiteralCons => {
                if (isConfigExtern(objectLiteralCons)) {
                    return singleConfig(objectLiteralCons);
                }

                return getAllValuesOf(objectLiteralCons, fixed_eval, fixed_trace);
            })
        }
        
        return unimplementedBottom(`Cannot get ith element of a non-array literal ${printNodeAndPos(tupleCons)}`);
    })
}

export function getAllValuesOf(objectCons: Config<ts.ObjectLiteralExpression>, fixed_eval: FixedEval, fixed_trace: FixedTrace) {
    const setOfProperties = Set.of(...objectCons.node.properties)
                
    return setFlatMap(setOfProperties, prop => {
        if (ts.isSpreadAssignment(prop)) {
            const expressionConses = fixed_eval(Config({ node: prop.expression, env: objectCons.env }));
            const expressionObjectLiteralConses = setFilter(expressionConses, isObjectLiteralExpressionConfig);

            return configSetJoinMap(expressionObjectLiteralConses, cons => getAllValuesOf(cons, fixed_eval, fixed_trace));
        }

        if (!ts.isIdentifier(prop.name)) {
            return unimplementedBottom(`Unkown kind of prop name: ${printNodeAndPos(prop.name)}`)
        }

        return getPropertyFromObjectCons(objectCons, prop.name, undefined, fixed_eval, fixed_trace)
    }) as ConfigSet;
}

export function resolvePromisesOfNode(config: Config, fixed_eval: FixedEval): ConfigSet {
    const conses = fixed_eval(config);
    return configSetJoinMap(conses, consConfig => {
        const { node: cons, env: consEnv } = consConfig
        if (isAsyncKeyword(cons)) { // i.e. it's a return value of an async function
            const sourceFunction = cons.parent;
            if (!isFunctionLikeDeclaration(sourceFunction)) {
                return unimplementedBottom(`Expected ${printNodeAndPos(sourceFunction)} to be the source of a promise value`);
            }
            const returnValuesOfAsyncFunction = fixed_eval(Config({ node: sourceFunction.body, env: consEnv }));
            return configSetJoinMap(returnValuesOfAsyncFunction, (retConfig) => resolvePromisesOfNode(retConfig, fixed_eval));
        } else {
            return singleConfig(consConfig);
        }
    })
}

export function getMapSetCalls(returnSiteConfigs: ConfigSet, { fixed_eval }: { fixed_eval: FixedEval }): ConfigSet {
    const callSitesOrFalses = setMap(returnSiteConfigs, siteConfig => {
        if (!isConfigNoExtern(siteConfig)) {
            return siteConfig;
        }

        const site = siteConfig.node;
        const access = site.parent;
        if (!(ts.isPropertyAccessExpression(access))) {
            return false;
        }
        const accessConses = fixed_eval(Config({ node: access, env: siteConfig.env }));
        if (!configSetSome(accessConses, consConfig =>
                isBuiltInConstructorShapedConfig(consConfig)
                && getBuiltInValueOfBuiltInConstructor(consConfig, fixed_eval) === 'Map#set'
            )
        ) {
            return false;
        }

        const call = access.parent;
        if (!ts.isCallExpression(call)) {
            return false;
        }

        return Config({ node: call, env: siteConfig.env });
    });
    return setSift(callSitesOrFalses);
}

export function subsumes(a: Cursor, b: Cursor): boolean {
    if (isExtern(a)) {
        return true;
    }

    if (isExtern(b)) {
        return false;
    }

    const aString = getStringOf(a);
    const bString = getStringOf(b);
    return aString === bString;
}

function getStringOf(node: AnalysisNode) {
    if (isIdentifier(node)) {
        return node.text;
    } else if (isStringLiteral(node)) {
        return JSON.parse(node.text);
    } else {
        return unimplemented(`Uknown how to get string of ${printNodeAndPos(node)}`, '')
    }
}
