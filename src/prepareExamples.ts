import { execSync } from 'child_process';
import { getRootFolder, getTsConfigPath } from './util';
import { preprocess } from './preprocess';
import path from 'path';

export function prepareNextCrm() {
    const sourceRootFolder = getRootFolder('../../examples/nextcrm-app');

    execSync(`cd ${sourceRootFolder} && npx babel . --out-dir dist --extensions ".js,.jsx,.ts,.tsx" && cp ./tsconfig.json ./dist/tsconfig.json && sed -i 's/"next-env\\.d\\.ts", "\\*\\*\\/\\*\\.ts", "\\*\\*\\/\\*\\.tsx", "\\.next\\/types\\/\\*\\*\\/\\*\\.ts"/"\\*\\*\\/\\*\\.js"/g' ./dist/tsconfig.json`);

    const distRootFolder = path.resolve(sourceRootFolder, './dist');
    const tsConfigPath = getTsConfigPath(distRootFolder);
    preprocess(tsConfigPath);
}

export function prepareFormbricks() {
    const sourceRootFolder = getRootFolder('../../examples/formbricks/apps/web');
    const tsConfigPath = getTsConfigPath(sourceRootFolder);
    preprocess(tsConfigPath);
}
