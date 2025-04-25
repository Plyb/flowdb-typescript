import ts, { isObjectLiteralExpression, SyntaxKind } from 'typescript';
import { FixedEval, FixedTrace } from './dcfa';
import { SimpleSet } from 'typescript-super-set';
import { structuralComparator } from './comparators';
import { empty, setFilter, setFlatMap, setMap, setSift, setSome, singleton } from './setUtil';
import { unimplemented } from './util';
import { isAsyncKeyword, isFunctionLikeDeclaration, isStatic, printNodeAndPos, SimpleFunctionLikeDeclaration } from './ts-utils';
import { Config, ConfigSet, configSetSome, singleConfig, isConfigNoExtern, configSetJoinMap, unimplementedBottom, ConfigNoExtern, configSetFilter, isObjectLiteralExpressionConfig, isConfigExtern, join, isAssignmentExpressionConfig, justExtern } from './configuration';
import { getBuiltInValueOfBuiltInConstructor, getPropertyOfProto, getProtoOf, isBuiltInConstructorShapedConfig, resultOfElementAccess, resultOfPropertyAccess } from './value-constructors';
import { getDependencyInjected, isDecoratorIndicatingDependencyInjectable, isDependencyAccessExpression } from './nestjs-dependency-injection';
import { Cursor, isExtern } from './abstract-values';


export function getObjectProperty(accessConfig: Config<ts.PropertyAccessExpression>, typeChecker: ts.TypeChecker, fixed_eval: FixedEval, fixed_trace: FixedTrace): ConfigSet {
    const { node: access, env } = accessConfig;
    if (isDependencyAccessExpression(access)) {
        return getDependencyInjected({ node: access, env}, typeChecker, fixed_eval);
    }

    const expressionConses = fixed_eval({ node: access.expression, env });
    const property = access.name;
    return configSetJoinMap(expressionConses, consConfig => {
        return getPropertyFromObjectCons(consConfig, property, accessConfig, fixed_eval, fixed_trace);
    })
}

function nameMatches(lhs: ConfigNoExtern, name: string, fixed_eval: FixedEval): boolean {
    if (ts.isPropertyAccessExpression(lhs.node)) {
        return lhs.node.name.text === name;
    } else if (ts.isElementAccessExpression(lhs.node)) {
        const indexConses = fixed_eval({ node: lhs.node.argumentExpression, env: lhs.env });
        return setSome(indexConses, cons => subsumes(cons.node, name));
    }
    throw new Error(`Unknown left hand side: ${printNodeAndPos(lhs.node)}`)
}

function getPropertyFromObjectCons(consConfig: ConfigNoExtern, property: ts.MemberName, originalAccessConfig: Config<ts.PropertyAccessExpression> | undefined, fixed_eval: FixedEval, fixed_trace: FixedTrace): ConfigSet {
    if (property.text === '$transaction') {
        return justExtern; // assumption: there are no other "%transaction"s besides the prisma ones
    }
    
    return join(getPropertyFromSourceConstructor(), getPropertyFromMutations());

    function getPropertyFromMutations(): ConfigSet {
        // assumption: we're not going to be mutating an error that we threw
        if (ts.isThrowStatement(consConfig.node.parent)
            && ts.isNewExpression(consConfig.node)
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
        const refGrandparents = setMap(tracedSites, ref => ({ node: ref.node.parent.parent, env: ref.env }));
        const refAssignments = setFilter(refGrandparents, isAssignmentExpressionConfig);
        const refAssignmentsWithMatching = setFilter(refAssignments, assignment => 
            nameMatches(
                { node: assignment.node.left, env: assignment.env}, property.text,fixed_eval
            )
        );
        return setMap(refAssignmentsWithMatching, assignmentExpression => {
            if (assignmentExpression.node.operatorToken.kind !== SyntaxKind.EqualsToken) {
                return assignmentExpression;
            }

            return { node: assignmentExpression.node.right, env: assignmentExpression.env };
        })
    }

    function getPropertyFromSourceConstructor() {
        const { node: cons, env: consEnv } = consConfig;
        if (ts.isObjectLiteralExpression(cons)) {
            for (const prop of [...cons.properties].reverse()) {
                if (ts.isSpreadAssignment(prop)) {
                    const spreadConses = fixed_eval({ node: prop.expression, env: consConfig.env });
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
                    return fixed_eval({ node: prop.initializer, env: consEnv });
                } else if (ts.isShorthandPropertyAssignment(prop)) {
                    return fixed_eval({ node: prop.name, env: consEnv })
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
            return resultOfPropertyAccess[builtInValue](originalAccessConfig, { fixed_eval });
        } else if (isDecoratorIndicatingDependencyInjectable(consConfig.node)) {
            const classDeclaration = consConfig.node.parent;
            if (!ts.isClassDeclaration(classDeclaration)) {
                return unimplementedBottom(`Expected ${printNodeAndPos(classDeclaration)} to be a class declaration`);
            }
    
            const reversedMembers = [...classDeclaration.members].reverse();
            for (const member of reversedMembers) {
                if (member.name !== undefined && ts.isIdentifier(member.name) && member.name.text === property.text) {
                    return singleConfig({ node: member, env: consEnv });
                }
            }
            return unimplementedBottom(`Unable to member ${printNodeAndPos(property)} in ${printNodeAndPos(classDeclaration)}`);
        } else if (ts.isClassDeclaration(consConfig.node)) {
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
            return singleConfig({ node: staticProperty, env: consConfig.env });
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

export function getElementNodesOfArrayValuedNode(config: Config, { fixed_eval, fixed_trace, m }: { fixed_eval: FixedEval, fixed_trace: FixedTrace, m: number }, accessConfig?: Config<ts.ElementAccessExpression>): ConfigSet {
    const conses = fixed_eval(config);
    return configSetJoinMap(conses, consConfig => {
        const { node: cons, env: consEnv } = consConfig;
        if (ts.isArrayLiteralExpression(cons)) {
            const elements = new SimpleSet(structuralComparator, ...cons.elements.map(elem => ({
                node: elem,
                env: consEnv,
            } as Config)));
            return configSetJoinMap(elements, elementConfig => {
                if (ts.isSpreadElement(elementConfig.node)) {
                    const subElements = getElementNodesOfArrayValuedNode(
                        { node: elementConfig.node.expression, env: elementConfig.env },
                        { fixed_eval, fixed_trace, m }
                    );
                    return subElements;
                }

                return singleConfig(elementConfig);
            })
        } else if (isBuiltInConstructorShapedConfig(consConfig)) {
            const builtInValue = getBuiltInValueOfBuiltInConstructor(consConfig, fixed_eval)
            return resultOfElementAccess[builtInValue](consConfig, { accessConfig, fixed_eval, fixed_trace, m });
        } else {
            return unimplemented(`Unable to access element of ${printNodeAndPos(cons)}`, empty());
        }
    });
}

// Arrays are sometimes used as tuples in JS. For it to make sense to treat an array as a tuple, it should never be mutated
// and it should be straightforward to find the ith element.
export function getElementOfArrayOfTuples(config: Config, i: number, fixed_eval: FixedEval, fixed_trace: FixedTrace, m: number) {
    const arrayConses = fixed_eval(config);
    return configSetJoinMap(arrayConses, arrayConsConfig => {
        if (isBuiltInConstructorShapedConfig(arrayConsConfig)) {
            const builtInValue = getBuiltInValueOfBuiltInConstructor(arrayConsConfig, fixed_eval);
            if (builtInValue === 'Object.entries()') {
                if (!ts.isCallExpression(arrayConsConfig.node) || !ts.isPropertyAccessExpression(arrayConsConfig.node.expression)) {
                    return unimplementedBottom(`Expected ${printNodeAndPos(arrayConsConfig.node)} to be of the shape (....).entries(....)`);
                }
    
                if (i !== 1) {
                    return unimplementedBottom(`Getting anything but the values from Object#entries() is not yet implemented ${printNodeAndPos(config.node)}`)
                }
    
                const objectConses = fixed_eval({ node: arrayConsConfig.node.arguments[0], env: arrayConsConfig.env });
                const objectLiteralConses = configSetFilter(objectConses, isObjectLiteralExpressionConfig)
                return configSetJoinMap(objectLiteralConses, objectLiteralCons => {
                    if (isConfigExtern(objectLiteralCons)) {
                        return singleConfig(objectLiteralCons);
                    }
    
                    return getAllValuesOf(objectLiteralCons, fixed_eval, fixed_trace);
                })
            }
        }


        const arrayElementNodes = getElementNodesOfArrayValuedNode(arrayConsConfig, { fixed_eval, fixed_trace, m });
        return configSetJoinMap(arrayElementNodes, tupleConfig => getElementOfTuple(tupleConfig, i, fixed_eval));
    })
}

export function getElementOfTuple(tupleConfig: Config, i: number, fixed_eval: FixedEval) {
    const tupleConses = fixed_eval(tupleConfig);
    return configSetJoinMap(tupleConses, ({ node: tupleCons, env: tupleEnv }) => {
        if (!ts.isArrayLiteralExpression(tupleCons)) {
            return unimplementedBottom(`Cannot get ith element of a non-array literal ${printNodeAndPos(tupleCons)}`);
        }

        return singleConfig({
            node: tupleCons.elements[i],
            env: tupleEnv,
        });
    })
}

export function getAllValuesOf(objectCons: Config<ts.ObjectLiteralExpression>, fixed_eval: FixedEval, fixed_trace: FixedTrace) {
    const setOfProperties = new SimpleSet(structuralComparator, ...objectCons.node.properties)
                
    return setFlatMap(setOfProperties, prop => {
        if (ts.isSpreadAssignment(prop)) {
            const expressionConses = fixed_eval({ node: prop.expression, env: objectCons.env });
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
            const returnValuesOfAsyncFunction = fixed_eval({ node: sourceFunction.body, env: consEnv });
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
        const accessConses = fixed_eval({ node: access, env: siteConfig.env });
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

        return { node: call, env: siteConfig.env };
    });
    return setSift(callSitesOrFalses);
}

export function subsumes(node: Cursor, str: string): boolean {
    if (isExtern(node)) {
        return true;
    }

    if (ts.isIdentifier(node)) {
        return node.text === str;
    }

    if (ts.isStringLiteral(node)) {
        return JSON.parse(node.text) === str;
    }

    return unimplemented(`Unknown type for subsumes: ${printNodeAndPos(node)}`, false);
}
