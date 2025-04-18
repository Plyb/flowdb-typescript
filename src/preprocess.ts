import ts from 'typescript';
import { Project, SyntaxKind } from 'ts-morph';

export function preprocess(tsConfigPath: string) {
    const project = new Project({ tsConfigFilePath: tsConfigPath });

    changeReactCreateElementToFunctionCall(project);

    project.saveSync();
}

function changeReactCreateElementToFunctionCall(project: Project) {
    for (const sf of project.getSourceFiles()) {
        sf.forEachDescendant(node => {
            if (!node.isKind(SyntaxKind.CallExpression)) {
                return;
            }
            const expression = node.getExpression();
            if (!(expression.isKind(SyntaxKind.Identifier)
                    && (expression.getText() === '_jsx'
                        || expression.getText() === '_jsxs'
                    )
                )
            ) {
                return;
            }
            const firstArg = node.getArguments()[0];
            if (!firstArg.isKind(SyntaxKind.Identifier)) {
                return;
            }

            node.setExpression(firstArg.getText());
            node.removeArgument(firstArg);
        })
    }
}