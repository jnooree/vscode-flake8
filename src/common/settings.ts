// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { ConfigurationChangeEvent, ConfigurationScope, WorkspaceConfiguration, WorkspaceFolder } from 'vscode';
import { traceLog } from './log/logging';
import { getInterpreterDetails } from './python';
import { getConfiguration, getWorkspaceFolders } from './vscodeapi';

/* eslint-disable @typescript-eslint/naming-convention */
const DEFAULT_SEVERITY: Record<string, string> = {
    E: 'Error',
    F: 'Error',
    I: 'Information',
    W: 'Warning',
};
export interface ISettings {
    cwd: string;
    workspace: string;
    args: string[];
    severity: Record<string, string>;
    path: string[];
    interpreter: string[];
    importStrategy: string;
    showNotifications: string;
}

export function getExtensionSettings(namespace: string, includeInterpreter?: boolean): Promise<ISettings[]> {
    return Promise.all(getWorkspaceFolders().map((w) => getWorkspaceSettings(namespace, w, includeInterpreter)));
}

function resolveVariables(value: string[], workspace?: WorkspaceFolder): string[] {
    const substitutions = new Map<string, string>();
    const home = process.env.HOME || process.env.USERPROFILE;
    if (home) {
        substitutions.set('${userHome}', home);
    }
    if (workspace) {
        substitutions.set('${workspaceFolder}', workspace.uri.fsPath);
    }
    substitutions.set('${cwd}', process.cwd());
    getWorkspaceFolders().forEach((w) => {
        substitutions.set('${workspaceFolder:' + w.name + '}', w.uri.fsPath);
    });

    return value.map((s) => {
        for (const [key, value] of substitutions) {
            s = s.replace(key, value);
        }
        return s;
    });
}

function getArgs(namespace: string, workspace: WorkspaceFolder): string[] {
    const config = getConfiguration(namespace, workspace.uri);
    const args = config.get<string[]>('args', []);

    if (args.length > 0) {
        return args;
    }

    const legacyConfig = getConfiguration('python', workspace.uri);
    const legacyArgs = legacyConfig.get<string[]>('linting.flake8Args', []);
    if (legacyArgs.length > 0) {
        traceLog('Using legacy Flake8 args from `python.linting.flake8Args`');
        return legacyArgs;
    }

    return [];
}

function getPath(namespace: string, workspace: WorkspaceFolder): string[] {
    const config = getConfiguration(namespace, workspace.uri);
    const path = config.get<string[]>('path', []);

    if (path.length > 0) {
        return path;
    }

    const legacyConfig = getConfiguration('python', workspace.uri);
    const legacyPath = legacyConfig.get<string>('linting.flake8Path', '');
    if (legacyPath.length > 0 && legacyPath !== 'flake8') {
        traceLog('Using legacy Flake8 path from `python.linting.flake8Path`');
        return [legacyPath];
    }
    return [];
}

function getCwd(workspace: WorkspaceFolder): string {
    const legacyConfig = getConfiguration('python', workspace.uri);
    const legacyCwd = legacyConfig.get<string>('linting.cwd');

    if (legacyCwd) {
        traceLog('Using cwd from `python.linting.cwd`.');
        return resolveVariables([legacyCwd], workspace)[0];
    }

    return workspace.uri.fsPath;
}

export function getInterpreterFromSetting(namespace: string, scope?: ConfigurationScope) {
    const config = getConfiguration(namespace, scope);
    return config.get<string[]>('interpreter');
}

export async function getWorkspaceSettings(
    namespace: string,
    workspace: WorkspaceFolder,
    includeInterpreter?: boolean,
): Promise<ISettings> {
    const config = getConfiguration(namespace, workspace.uri);

    let interpreter: string[] = [];
    if (includeInterpreter) {
        interpreter = getInterpreterFromSetting(namespace, workspace) ?? [];
        if (interpreter.length === 0) {
            interpreter = (await getInterpreterDetails(workspace.uri)).path ?? [];
        }
    }

    const args = getArgs(namespace, workspace);
    const path = getPath(namespace, workspace);
    const workspaceSetting = {
        cwd: getCwd(workspace),
        workspace: workspace.uri.toString(),
        args: resolveVariables(args, workspace),
        severity: config.get<Record<string, string>>('severity', DEFAULT_SEVERITY),
        path: resolveVariables(path, workspace),
        interpreter: resolveVariables(interpreter, workspace),
        importStrategy: config.get<string>('importStrategy', 'fromEnvironment'),
        showNotifications: config.get<string>('showNotifications', 'off'),
    };
    return workspaceSetting;
}

function getGlobalValue<T>(config: WorkspaceConfiguration, key: string, defaultValue: T): T {
    const inspect = config.inspect<T>(key);
    return inspect?.globalValue ?? inspect?.defaultValue ?? defaultValue;
}

export async function getGlobalSettings(namespace: string, includeInterpreter?: boolean): Promise<ISettings> {
    const config = getConfiguration(namespace);

    let interpreter: string[] | undefined = [];
    if (includeInterpreter) {
        interpreter = getGlobalValue<string[]>(config, 'interpreter', []);
        if (interpreter === undefined || interpreter.length === 0) {
            interpreter = (await getInterpreterDetails()).path;
        }
    }

    const setting = {
        cwd: process.cwd(),
        workspace: process.cwd(),
        args: getGlobalValue<string[]>(config, 'args', []),
        severity: getGlobalValue<Record<string, string>>(config, 'severity', DEFAULT_SEVERITY),
        path: getGlobalValue<string[]>(config, 'path', []),
        interpreter: interpreter ?? [],
        importStrategy: getGlobalValue<string>(config, 'importStrategy', 'fromEnvironment'),
        showNotifications: getGlobalValue<string>(config, 'showNotifications', 'off'),
    };
    return setting;
}

export function checkIfConfigurationChanged(e: ConfigurationChangeEvent, namespace: string): boolean {
    const settings = [
        `${namespace}.args`,
        `${namespace}.severity`,
        `${namespace}.path`,
        `${namespace}.interpreter`,
        `${namespace}.importStrategy`,
        `${namespace}.showNotifications`,
    ];
    const changed = settings.map((s) => e.affectsConfiguration(s));
    return changed.includes(true);
}
