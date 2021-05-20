'use strict';

import * as vscode from 'vscode';

import { FileExplorer } from './fileExplorer';

export function activate(context: vscode.ExtensionContext) {

	new FileExplorer(context);

}