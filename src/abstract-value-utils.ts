import ts from 'typescript';
import { FixedEval, FixedTrace } from './dcfa';
import { configSetJoinMap, unimplementedVal } from './abstract-values';
import { SimpleSet } from 'typescript-super-set';
import { structuralComparator } from './comparators';
import { empty, setMap, setSift } from './setUtil';
import { unimplemented } from './util';
import { isAsyncKeyword, isFunctionLikeDeclaration, printNodeAndPos, SimpleFunctionLikeDeclaration } from './ts-utils';
import { Config, ConfigSet, configSetSome, singleConfig, isConfigNoExtern } from './configuration';
import { getBuiltInValueOfBuiltInConstructor, getPropertyOfProto, getProtoOf, isBuiltInConstructorShapedConfig, resultOfElementAccess, resultOfPropertyAccess } from './value-constructors';


export function getObjectProperty(accessConfig: Config<ts.PropertyAccessExpression>, fixed_eval: FixedEval, targetFunction: SimpleFunctionLikeDeclaration): ConfigSet {
    const { node: access, env } = accessConfig;
    const expressionConses = fixed_eval({ node: access.expression, env });
    const property = access.name;
    return configSetJoinMap(expressionConses, consConfig => {
        const { node: cons, env: consEnv } = consConfig;
        if (ts.isObjectLiteralExpression(cons)) {
            for (const prop of cons.properties) {
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
            return unimplementedVal(`Unable to find object property ${printNodeAndPos(property)}`)
        } else if (isBuiltInConstructorShapedConfig(consConfig)) {
            const builtInValue = getBuiltInValueOfBuiltInConstructor(consConfig, fixed_eval, targetFunction);
            return resultOfPropertyAccess[builtInValue](accessConfig, { fixed_eval });
        } else {
            const proto = getProtoOf(cons);
            if (proto === null) {
                return unimplementedVal(`No constructors found for property access ${printNodeAndPos(access)}`);
            }
            return getPropertyOfProto(proto, property.text, consConfig, accessConfig, fixed_eval);
        }
    })
}

export function getElementNodesOfArrayValuedNode(config: Config, { fixed_eval, fixed_trace, targetFunction, m }: { fixed_eval: FixedEval, fixed_trace: FixedTrace, targetFunction: SimpleFunctionLikeDeclaration, m: number }): ConfigSet {
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
                        { fixed_eval, fixed_trace, targetFunction, m }
                    );
                    return subElements;
                }

                return singleConfig(elementConfig);
            })
        } else if (isBuiltInConstructorShapedConfig(consConfig)) {
            const builtInValue = getBuiltInValueOfBuiltInConstructor(consConfig, fixed_eval, targetFunction)
            return resultOfElementAccess[builtInValue](consConfig, { fixed_eval, fixed_trace, targetFunction, m });
        } else {
            return unimplemented(`Unable to access element of ${printNodeAndPos(cons)}`, empty());
        }
    });
}

export function resolvePromisesOfNode(config: Config, fixed_eval: FixedEval): ConfigSet {
    const conses = fixed_eval(config);
    return configSetJoinMap(conses, consConfig => {
        const { node: cons, env: consEnv } = consConfig
        if (isAsyncKeyword(cons)) { // i.e. it's a return value of an async function
            const sourceFunction = cons.parent;
            if (!isFunctionLikeDeclaration(sourceFunction)) {
                return unimplementedVal(`Expected ${printNodeAndPos(sourceFunction)} to be the source of a promise value`);
            }
            return fixed_eval({ node: sourceFunction.body, env: consEnv });
        } else {
            return singleConfig(consConfig);
        }
    })
}

export function getMapSetCalls(returnSiteConfigs: ConfigSet, { fixed_eval, targetFunction }: { fixed_eval: FixedEval, targetFunction: SimpleFunctionLikeDeclaration }): ConfigSet {
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
                && getBuiltInValueOfBuiltInConstructor(consConfig, fixed_eval, targetFunction) === 'Map#set'
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
