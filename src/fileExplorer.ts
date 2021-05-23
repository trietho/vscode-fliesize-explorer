import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';
import * as fastFolderSize from 'fast-folder-size'
import * as filesize from 'filesize'
import gzipSize = require('gzip-size');

namespace _ {

	function handleResult<T>(resolve: (result: T) => void, reject: (error: Error) => void, error: Error | null | undefined, result: T): void {
		if (error) {
			reject(massageError(error));
		} else {
			resolve(result);
		}
	}

	function massageError(error: Error & { code?: string }): Error {
		if (error.code === 'ENOENT') {
			return vscode.FileSystemError.FileNotFound();
		}

		if (error.code === 'EISDIR') {
			return vscode.FileSystemError.FileIsADirectory();
		}

		if (error.code === 'EEXIST') {
			return vscode.FileSystemError.FileExists();
		}

		if (error.code === 'EPERM' || error.code === 'EACCESS' || error.code === 'EBUSY') {
			return vscode.FileSystemError.NoPermissions();
		}

		return error;
	}

	export function checkCancellation(token: vscode.CancellationToken): void {
		if (token.isCancellationRequested) {
			throw new Error('Operation cancelled');
		}
	}

	export function normalizeNFC(items: string): string;
	export function normalizeNFC(items: string[]): string[];
	export function normalizeNFC(items: string | string[]): string | string[] {
		if (process.platform !== 'darwin') {
			return items;
		}

		if (Array.isArray(items)) {
			return items.map(item => item.normalize('NFC'));
		}

		return items.normalize('NFC');
	}

	export function readdir(path: string): Promise<string[]> {
		return new Promise<string[]>((resolve, reject) => {
			try {
				fs.readdir(path, (error, children) => handleResult(resolve, reject, error, normalizeNFC(children)));
			} catch (error) {
				console.log(error);
			}
		});
	}

	export function stat(path: string): Promise<fs.Stats> | undefined {

		return new Promise<fs.Stats>((resolve, reject) => {
			try {
				var info = fs.statSync(path);
				return resolve(info);
			} catch (error) {
				return resolve(new fs.Stats())
			}

		});
	}

	export function readfile(path: string): Promise<Buffer> {
		return new Promise<Buffer>((resolve, reject) => {
			fs.readFile(path, (error, buffer) => handleResult(resolve, reject, error, buffer));
		});
	}

	export async function exists(path: string): Promise<boolean> {
		try {
			await promisify(fs.access)(path);
			return true;
		} catch {
			return false;
		}
	}

}

export class FileStat implements vscode.FileStat {

	constructor(private fsStat: fs.Stats) { }

	get type(): vscode.FileType {
		return this.fsStat.isFile() ? vscode.FileType.File : this.fsStat.isDirectory() ? vscode.FileType.Directory : this.fsStat.isSymbolicLink() ? vscode.FileType.SymbolicLink : vscode.FileType.Unknown;
	}

	get isFile(): boolean | undefined {
		return this.fsStat.isFile();
	}

	get isDirectory(): boolean | undefined {
		return this.fsStat.isDirectory();
	}

	get isSymbolicLink(): boolean | undefined {
		return this.fsStat.isSymbolicLink();
	}

	get size(): number {
		return this.fsStat.size;
	}

	get ctime(): number {
		return this.fsStat.ctime.getTime();
	}

	get mtime(): number {
		return this.fsStat.mtime.getTime();
	}
}

interface Entry {
	uri: vscode.Uri;
	type: vscode.FileType;
}

//#endregion

export class FileSystemProvider implements vscode.TreeDataProvider<Entry>, vscode.FileSystemProvider {

	private _onDidChangeFile: vscode.EventEmitter<vscode.FileChangeEvent[]>;
	private _onDidChangeTreeData: vscode.EventEmitter<Entry | undefined> = new vscode.EventEmitter<Entry | undefined>();
	readonly onDidChangeTreeData: vscode.Event<Entry | undefined> = this._onDidChangeTreeData.event;

	constructor() {
		this._onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	}

	watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
		const watcher = fs.watch(uri.fsPath, { recursive: options.recursive }, async (event: string, filename: string | Buffer) => {
			const filepath = path.join(uri.fsPath, _.normalizeNFC(filename.toString()));

			// TODO support excludes (using minimatch library?)

			this._onDidChangeFile.fire([{
				type: event === 'change' ? vscode.FileChangeType.Changed : await _.exists(filepath) ? vscode.FileChangeType.Created : vscode.FileChangeType.Deleted,
				uri: uri.with({ path: filepath })
			} as vscode.FileChangeEvent]);
		});

		return { dispose: () => watcher.close() };
	}

	stat(uri: vscode.Uri): vscode.FileStat | Thenable<vscode.FileStat> {
		return this._stat(uri.fsPath);
	}

	async _stat(path: string): Promise<vscode.FileStat> {
		return new FileStat(await _.stat(path));
	}

	readDirectory(uri: vscode.Uri): [string, vscode.FileType][] | Thenable<[string, vscode.FileType][]> {
		return this._readDirectory(uri);
	}

	async _readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
		const children = await _.readdir(uri.fsPath);

		const result: [string, vscode.FileType][] = [];
		for (let i = 0; i < children.length; i++) {
			const child = children[i];
			const stat = await this._stat(path.join(uri.fsPath, child));
			result.push([child, stat.type]);
		}

		return Promise.resolve(result);
	}

	readFile(uri: vscode.Uri): Uint8Array | Thenable<Uint8Array> {
		return _.readfile(uri.fsPath);
	}

	//#region 
	createDirectory(uri: vscode.Uri): void | Thenable<void> {
		throw new Error('Method not implemented.');
	}
	writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean; }): void | Thenable<void> {
		throw new Error('Method not implemented.');
	}
	delete(uri: vscode.Uri, options: { recursive: boolean; }): void | Thenable<void> {
		throw new Error('Method not implemented.');
	}
	rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean; }): void | Thenable<void> {
		throw new Error('Method not implemented.');
	}
	copy?(source: vscode.Uri, destination: vscode.Uri, options: { overwrite: boolean; }): void | Thenable<void> {
		throw new Error('Method not implemented.');
	}

	getParent?(element: Entry): vscode.ProviderResult<Entry> {
		throw new Error('Method not implemented.');
	}
	// resolveTreeItem?(item: vscode.TreeItem, element: Entry, token: vscode.CancellationToken): vscode.ProviderResult<vscode.TreeItem> {
	// 	throw new Error('Method not implemented.');
	// }

	get onDidChangeFile(): vscode.Event<vscode.FileChangeEvent[]> {
		return this._onDidChangeFile.event;
	}
	//#endregion

	async getChildren(element?: Entry): Promise<Entry[]> {

		if (vscode.workspace.workspaceFolders == null)
			return [];

		if (element) {
			const children = await this.readDirectory(element.uri);
			return children.map(([name, type]) => ({ uri: vscode.Uri.file(path.join(element.uri.fsPath, name)), type }));
		}

		const workspaceFolder = vscode.workspace.workspaceFolders.filter(folder => folder.uri.scheme === 'file')[0];
		if (workspaceFolder) {
			const children = await this.readDirectory(workspaceFolder.uri);
			children.sort((a, b) => {
				if (a[1] === b[1]) {
					return a[0].localeCompare(b[0]);
				}
				return a[1] === vscode.FileType.Directory ? -1 : 1;
			});
			return children.map(([name, type]) => ({ uri: vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, name)), type }));
		}

		return [];
	}

	refreshFile(element: Entry) {
		this._onDidChangeTreeData.fire(element);// _onDidChangeFile.fire([{type: vscode.FileChangeType.Changed, uri: element}]);
	}

	openFolder(element: Entry) {
		vscode.commands.executeCommand("revealFileInOS", element.uri);
	}

	async getTreeItem(element: Entry): Promise<vscode.TreeItem> {
		const treeItem = new vscode.TreeItem(element.uri, element.type === vscode.FileType.Directory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);

		var size: number = 0;
		if (element.type === vscode.FileType.File) {
			treeItem.command = { command: 'fileExplorer.openFile', title: "Open File", arguments: [element.uri], };
			treeItem.contextValue = 'file';
			try {
				size = (await this.stat(element.uri)).size;
			} catch (error) {

			}

			treeItem.description = ` -  ${filesize(size)} - (${filesize(this._getGzipSize(element.uri.fsPath))})`;

		} else if (element.type == vscode.FileType.Directory) {

			size = (await this._getDirSize(element.uri.fsPath)) as number;
			treeItem.description = ` - ${filesize(size)}`;
		}
		//treeItem.tooltip = element.uri.fsPath;
		return treeItem;
	}

	_getGzipSize(path: string): number {
		try {
			return gzipSize.fileSync(path);
		} catch (error) {
			return 0;
		}
	}

	_getDirSize(path: String) {
		return new Promise((resolve, reject) => {
			try {
				fastFolderSize(path, (err, result) => {
					resolve(result)
				});
			} catch (error) {
				resolve(0)
			}

		})
	}
}

export class FileExplorer {
	constructor(context: vscode.ExtensionContext) {
		const treeDataProvider = new FileSystemProvider();
		context.subscriptions.push(vscode.window.createTreeView('fileExplorer', { treeDataProvider }));
		vscode.commands.registerCommand('fileExplorer.openFile', (resource) => this.openResource(resource));
		vscode.commands.registerCommand('fileExplorer.refreshFile', (resource) => treeDataProvider.refreshFile(resource));
		vscode.commands.registerCommand('fileExplorer.refreshRoot', (resource) => treeDataProvider.refreshFile(undefined));
		vscode.commands.registerCommand('fileExplorer.openFolder', (resource) => treeDataProvider.openFolder(resource));

	}

	private openResource(resource: vscode.Uri): void {
		vscode.commands.executeCommand("vscode.open", resource);
	}
}