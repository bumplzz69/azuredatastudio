/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const gulp = require('gulp');
const fs = require('fs');
const os = require('os');
const cp = require('child_process');
const path = require('path');
const es = require('event-stream');
const azure = require('gulp-azure-storage');
const electron = require('gulp-atom-electron');
const vfs = require('vinyl-fs');
const rename = require('gulp-rename');
const replace = require('gulp-replace');
const filter = require('gulp-filter');
const json = require('gulp-json-editor');
const _ = require('underscore');
const util = require('./lib/util');
const ext = require('./lib/extensions');
const buildfile = require('../src/buildfile');
const common = require('./lib/optimize');
const root = path.dirname(__dirname);
const commit = util.getVersion(root);
const packageJson = require('../package.json');
const product = require('../product.json');
const crypto = require('crypto');
const i18n = require('./lib/i18n');
// {{SQL CARBON EDIT}}
const serviceDownloader = require('service-downloader').ServiceDownloadProvider;
const platformInfo = require('service-downloader/out/platform').PlatformInformation;
const glob = require('glob');
const deps = require('./dependencies');
const getElectronVersion = require('./lib/electron').getElectronVersion;
const createAsar = require('./lib/asar').createAsar;

const productionDependencies = deps.getProductionDependencies(path.dirname(__dirname));
// @ts-ignore
// {{SQL CARBON EDIT}}
var del = require('del');
const extensionsRoot = path.join(root, 'extensions');
const extensionsProductionDependencies = deps.getProductionDependencies(extensionsRoot);
const baseModules = Object.keys(process.binding('natives')).filter(n => !/^_|\//.test(n));
// {{SQL CARBON EDIT}}
const nodeModules = [
	'electron',
	'original-fs',
	'rxjs/Observable',
	'rxjs/Subject',
	'rxjs/Observer',
	'ng2-charts/ng2-charts']
	.concat(Object.keys(product.dependencies || {}))
	.concat(_.uniq(productionDependencies.map(d => d.name)))
	.concat(baseModules);


// Build
const builtInExtensions = require('./builtInExtensions.json');

const excludedExtensions = [
	'vscode-api-tests',
	'vscode-colorize-tests',
	'ms-vscode.node-debug',
	'ms-vscode.node-debug2',
	// {{SQL CARBON EDIT}}
	'integration-tests',
];

// {{SQL CARBON EDIT}}
const vsce = require('vsce');
const sqlBuiltInExtensions = [
	// Add SQL built-in extensions here.
	// the extension will be excluded from SQLOps package and will have separate vsix packages
	'agent',
	'import',
	'profiler'
];
var azureExtensions =  [ 'azurecore', 'mssql'];

const vscodeEntryPoints = _.flatten([
	buildfile.entrypoint('vs/workbench/workbench.main'),
	buildfile.base,
	buildfile.workbench,
	buildfile.code
]);

const vscodeResources = [
	'out-build/main.js',
	'out-build/cli.js',
	'out-build/driver.js',
	'out-build/bootstrap.js',
	'out-build/bootstrap-amd.js',
	'out-build/paths.js',
	'out-build/vs/**/*.{svg,png,cur,html}',
	'out-build/vs/base/common/performance.js',
	'out-build/vs/base/node/{stdForkStart.js,terminateProcess.sh,cpuUsage.sh}',
	'out-build/vs/base/browser/ui/octiconLabel/octicons/**',
	'out-build/vs/workbench/browser/media/*-theme.css',
	'out-build/vs/workbench/electron-browser/bootstrap/**',
	'out-build/vs/workbench/parts/debug/**/*.json',
	'out-build/vs/workbench/parts/execution/**/*.scpt',
	'out-build/vs/workbench/parts/webview/electron-browser/webview-pre.js',
	'out-build/vs/**/markdown.css',
	'out-build/vs/workbench/parts/tasks/**/*.json',
	'out-build/vs/workbench/parts/welcome/walkThrough/**/*.md',
	'out-build/vs/workbench/services/files/**/*.exe',
	'out-build/vs/workbench/services/files/**/*.md',
	'out-build/vs/code/electron-browser/sharedProcess/sharedProcess.js',
	'out-build/vs/code/electron-browser/issue/issueReporter.js',
	'out-build/vs/code/electron-browser/processExplorer/processExplorer.js',
	// {{SQL CARBON EDIT}}
	'out-build/sql/workbench/electron-browser/splashscreen/*',
	'out-build/sql/**/*.{svg,png,cur,html}',
	'out-build/sql/base/browser/ui/table/media/*.{gif,png,svg}',
	'out-build/sql/base/browser/ui/checkbox/media/*.{gif,png,svg}',
	'out-build/sql/parts/admin/**/*.html',
	'out-build/sql/parts/connection/connectionDialog/media/*.{gif,png,svg}',
	'out-build/sql/parts/common/dblist/**/*.html',
	'out-build/sql/parts/dashboard/**/*.html',
	'out-build/sql/parts/disasterRecovery/**/*.html',
	'out-build/sql/parts/common/modal/media/**',
	'out-build/sql/parts/grid/load/lib/**',
	'out-build/sql/parts/grid/load/loadJquery.js',
	'out-build/sql/parts/grid/media/**',
	'out-build/sql/parts/grid/views/**/*.html',
	'out-build/sql/parts/tasks/**/*.html',
	'out-build/sql/parts/taskHistory/viewlet/media/**',
	'out-build/sql/parts/jobManagement/common/media/*.svg',
	'out-build/sql/media/objectTypes/*.svg',
	'out-build/sql/media/icons/*.svg',
	'out-build/sql/parts/notebook/media/**/*.svg',
	'!**/test/**'
];

const BUNDLED_FILE_HEADER = [
	'/*!--------------------------------------------------------',
	' * Copyright (C) Microsoft Corporation. All rights reserved.',
	' *--------------------------------------------------------*/'
].join('\n');

gulp.task('clean-optimized-vscode', util.rimraf('out-vscode'));
gulp.task('optimize-vscode', ['clean-optimized-vscode', 'compile-build', 'compile-extensions-build'], common.optimizeTask({
	src: 'out-build',
	entryPoints: vscodeEntryPoints,
	otherSources: [],
	resources: vscodeResources,
	loaderConfig: common.loaderConfig(nodeModules),
	header: BUNDLED_FILE_HEADER,
	out: 'out-vscode',
	bundleInfo: undefined
}));


gulp.task('optimize-index-js', ['optimize-vscode'], () => {
	const fullpath = path.join(process.cwd(), 'out-vscode/vs/workbench/electron-browser/bootstrap/index.js');
	const contents = fs.readFileSync(fullpath).toString();
	const newContents = contents.replace('[/*BUILD->INSERT_NODE_MODULES*/]', JSON.stringify(nodeModules));
	fs.writeFileSync(fullpath, newContents);
});

const baseUrl = `https://ticino.blob.core.windows.net/sourcemaps/${commit}/core`;
gulp.task('clean-minified-vscode', util.rimraf('out-vscode-min'));
gulp.task('minify-vscode', ['clean-minified-vscode', 'optimize-index-js'], common.minifyTask('out-vscode', baseUrl));

// Package

// @ts-ignore JSON checking: darwinCredits is optional
const darwinCreditsTemplate = product.darwinCredits && _.template(fs.readFileSync(path.join(root, product.darwinCredits), 'utf8'));

const config = {
	version: getElectronVersion(),
	productAppName: product.nameLong,
	companyName: 'Microsoft Corporation',
	copyright: 'Copyright (C) 2018 Microsoft. All rights reserved',
	darwinIcon: 'resources/darwin/code.icns',
	darwinBundleIdentifier: product.darwinBundleIdentifier,
	darwinApplicationCategoryType: 'public.app-category.developer-tools',
	darwinHelpBookFolder: 'VS Code HelpBook',
	darwinHelpBookName: 'VS Code HelpBook',
	darwinBundleDocumentTypes: [{
		name: product.nameLong + ' document',
		role: 'Editor',
		ostypes: ["TEXT", "utxt", "TUTX", "****"],
		// {{SQL CARBON EDIT}}
		extensions: ["csv", "json", "sqlplan", "sql", "xml"],
		iconFile: 'resources/darwin/code_file.icns'
	}],
	darwinBundleURLTypes: [{
		role: 'Viewer',
		name: product.nameLong,
		urlSchemes: [product.urlProtocol]
	}],
	darwinCredits: darwinCreditsTemplate ? Buffer.from(darwinCreditsTemplate({ commit: commit, date: new Date().toISOString() })) : void 0,
	linuxExecutableName: product.applicationName,
	winIcon: 'resources/win32/code.ico',
	token: process.env['VSCODE_MIXIN_PASSWORD'] || process.env['GITHUB_TOKEN'] || void 0,

	// @ts-ignore JSON checking: electronRepository is optional
	repo: product.electronRepository || void 0
};

function getElectron(arch) {
	return () => {
		const electronOpts = _.extend({}, config, {
			platform: process.platform,
			arch,
			ffmpegChromium: true,
			keepDefaultApp: true
		});

		return gulp.src('package.json')
		.pipe(json({ name: product.nameShort }))
			.pipe(electron(electronOpts))
			.pipe(filter(['**', '!**/app/package.json']))
			.pipe(vfs.dest('.build/electron'));
	};
}

gulp.task('clean-electron', util.rimraf('.build/electron'));
gulp.task('electron', ['clean-electron'], getElectron(process.arch));
gulp.task('electron-ia32', ['clean-electron'], getElectron('ia32'));
gulp.task('electron-x64', ['clean-electron'], getElectron('x64'));


/**
 * Compute checksums for some files.
 *
 * @param {string} out The out folder to read the file from.
 * @param {string[]} filenames The paths to compute a checksum for.
 * @return {Object} A map of paths to checksums.
 */
function computeChecksums(out, filenames) {
	var result = {};
	filenames.forEach(function (filename) {
		var fullPath = path.join(process.cwd(), out, filename);
		result[filename] = computeChecksum(fullPath);
	});
	return result;
}

/**
 * Compute checksum for a file.
 *
 * @param {string} filename The absolute path to a filename.
 * @return {string} The checksum for `filename`.
 */
function computeChecksum(filename) {
	var contents = fs.readFileSync(filename);

	var hash = crypto
		.createHash('md5')
		.update(contents)
		.digest('base64')
		.replace(/=+$/, '');

	return hash;
}

function packageBuiltInExtensions() {
	const sqlBuiltInLocalExtensionDescriptions = glob.sync('extensions/*/package.json')
			.map(manifestPath => {
				const extensionPath = path.dirname(path.join(root, manifestPath));
				const extensionName = path.basename(extensionPath);
				return { name: extensionName, path: extensionPath };
			})
			.filter(({ name }) => excludedExtensions.indexOf(name) === -1)
			.filter(({ name }) => builtInExtensions.every(b => b.name !== name))
			.filter(({ name }) => sqlBuiltInExtensions.indexOf(name) >= 0);
	sqlBuiltInLocalExtensionDescriptions.forEach(element => {
		const packagePath = path.join(path.dirname(root), element.name + '.vsix');
		console.info('Creating vsix for ' + element.path + ' result:' + packagePath);
		vsce.createVSIX({
				cwd: element.path,
				packagePath: packagePath,
				useYarn: true
		});
	});
}

function packageExtensionTask(extensionName, platform, arch) {
	var destination = path.join(path.dirname(root), 'azuredatastudio') + (platform ? '-' + platform : '') + (arch ? '-' + arch : '');
	if (platform === 'darwin') {
		destination = path.join(destination, 'Azure Data Studio.app', 'Contents', 'Resources', 'app', 'extensions', extensionName);
	} else {
		destination = path.join(destination, 'resources', 'app', 'extensions', extensionName);
	}

	platform = platform || process.platform;

	return () => {
		const root = path.resolve(path.join(__dirname, '..'));
		const localExtensionDescriptions = glob.sync('extensions/*/package.json')
			.map(manifestPath => {
				const extensionPath = path.dirname(path.join(root, manifestPath));
				const extensionName = path.basename(extensionPath);
				return { name: extensionName, path: extensionPath };
			})
			.filter(({ name }) => extensionName === name);

		const localExtensions = es.merge(...localExtensionDescriptions.map(extension => {
			return ext.fromLocal(extension.path);
		}));

		let result = localExtensions
			.pipe(util.skipDirectories())
			.pipe(util.fixWin32DirectoryPermissions())
			.pipe(filter(['**', '!LICENSE', '!LICENSES.chromium.html', '!version']));

		return result.pipe(vfs.dest(destination));
	};
}

function packageTask(platform, arch, opts) {
	opts = opts || {};

	// {{SQL CARBON EDIT}}
	const destination = path.join(path.dirname(root), 'azuredatastudio') + (platform ? '-' + platform : '') + (arch ? '-' + arch : '');
	platform = platform || process.platform;

	return () => {
		const out = opts.minified ? 'out-vscode-min' : 'out-vscode';

		const checksums = computeChecksums(out, [
			'vs/workbench/workbench.main.js',
			'vs/workbench/workbench.main.css',
			'vs/workbench/electron-browser/bootstrap/index.html',
			'vs/workbench/electron-browser/bootstrap/index.js',
			'vs/workbench/electron-browser/bootstrap/preload.js'
		]);

		const src = gulp.src(out + '/**', { base: '.' })
			.pipe(rename(function (path) { path.dirname = path.dirname.replace(new RegExp('^' + out), 'out'); }));

		const root = path.resolve(path.join(__dirname, '..'));
		const localExtensionDescriptions = glob.sync('extensions/*/package.json')
			.map(manifestPath => {
				const extensionPath = path.dirname(path.join(root, manifestPath));
				const extensionName = path.basename(extensionPath);
				return { name: extensionName, path: extensionPath };
			})
			.filter(({ name }) => excludedExtensions.indexOf(name) === -1)
			.filter(({ name }) => builtInExtensions.every(b => b.name !== name))
			// {{SQL CARBON EDIT}}
			.filter(({ name }) => sqlBuiltInExtensions.indexOf(name) === -1)
			.filter(({ name }) => azureExtensions.indexOf(name) === -1);

		packageBuiltInExtensions();

		const localExtensions = es.merge(...localExtensionDescriptions.map(extension => {
			return ext.fromLocal(extension.path)
				.pipe(rename(p => p.dirname = `extensions/${extension.name}/${p.dirname}`));
		}));

		// {{SQL CARBON EDIT}}
		const extensionDepsSrc = [
			..._.flatten(extensionsProductionDependencies.map(d => path.relative(root, d.path)).map(d => [`${d}/**`, `!${d}/**/{test,tests}/**`])),
		];

		const localExtensionDependencies = gulp.src(extensionDepsSrc, { base: '.', dot: true })
			.pipe(filter(['**', '!**/package-lock.json']))
			.pipe(util.cleanNodeModule('account-provider-azure', ['node_modules/date-utils/doc/**', 'node_modules/adal_node/node_modules/**'], undefined))
			.pipe(util.cleanNodeModule('typescript', ['**/**'], undefined));

		const sources = es.merge(src, localExtensions, localExtensionDependencies)
			.pipe(util.setExecutableBit(['**/*.sh']))
			.pipe(filter(['**', '!**/*.js.map']));

		let version = packageJson.version;
		// @ts-ignore JSON checking: quality is optional
		const quality = product.quality;

		if (quality && quality !== 'stable') {
			version += '-' + quality;
		}

		// {{SQL CARBON EDIT}}
		const name = (platform === 'darwin') ? 'Azure Data Studio' : product.nameShort;
		const packageJsonStream = gulp.src(['package.json'], { base: '.' })
			.pipe(json({ name, version }));

		const date = new Date().toISOString();
		const productJsonUpdate = { commit, date, checksums };

		if (shouldSetupSettingsSearch()) {
			productJsonUpdate.settingsSearchBuildId = getSettingsSearchBuildId(packageJson);
		}

		const productJsonStream = gulp.src(['product.json'], { base: '.' })
			.pipe(json(productJsonUpdate));

		const license = gulp.src(['LICENSES.chromium.html', 'LICENSE.txt', 'ThirdPartyNotices.txt', 'licenses/**'], { base: '.' });

		const watermark = gulp.src(['resources/letterpress.svg', 'resources/letterpress-dark.svg', 'resources/letterpress-hc.svg'], { base: '.' });

		// TODO the API should be copied to `out` during compile, not here
		const api = gulp.src('src/vs/vscode.d.ts').pipe(rename('out/vs/vscode.d.ts'));
    // {{SQL CARBON EDIT}}
		const dataApi = gulp.src('src/vs/data.d.ts').pipe(rename('out/sql/data.d.ts'));

		const depsSrc = [
			..._.flatten(productionDependencies.map(d => path.relative(root, d.path)).map(d => [`${d}/**`, `!${d}/**/{test,tests}/**`])),
			// @ts-ignore JSON checking: dependencies is optional
			..._.flatten(Object.keys(product.dependencies || {}).map(d => [`node_modules/${d}/**`, `!node_modules/${d}/**/{test,tests}/**`]))
		];

		const deps = gulp.src(depsSrc, { base: '.', dot: true })
			.pipe(filter(['**', '!**/package-lock.json']))
			.pipe(util.cleanNodeModule('fsevents', ['binding.gyp', 'fsevents.cc', 'build/**', 'src/**', 'test/**'], ['**/*.node']))
			.pipe(util.cleanNodeModule('oniguruma', ['binding.gyp', 'build/**', 'src/**', 'deps/**'], ['**/*.node', 'src/*.js']))
			.pipe(util.cleanNodeModule('windows-mutex', ['binding.gyp', 'build/**', 'src/**'], ['**/*.node']))
			.pipe(util.cleanNodeModule('native-keymap', ['binding.gyp', 'build/**', 'src/**', 'deps/**'], ['**/*.node']))
			.pipe(util.cleanNodeModule('native-is-elevated', ['binding.gyp', 'build/**', 'src/**', 'deps/**'], ['**/*.node']))
			.pipe(util.cleanNodeModule('native-watchdog', ['binding.gyp', 'build/**', 'src/**'], ['**/*.node']))
			.pipe(util.cleanNodeModule('spdlog', ['binding.gyp', 'build/**', 'deps/**', 'src/**', 'test/**'], ['**/*.node']))
			.pipe(util.cleanNodeModule('jschardet', ['dist/**']))
			.pipe(util.cleanNodeModule('windows-foreground-love', ['binding.gyp', 'build/**', 'src/**'], ['**/*.node']))
			.pipe(util.cleanNodeModule('windows-process-tree', ['binding.gyp', 'build/**', 'src/**'], ['**/*.node']))
			.pipe(util.cleanNodeModule('gc-signals', ['binding.gyp', 'build/**', 'src/**', 'deps/**'], ['**/*.node', 'src/index.js']))
			.pipe(util.cleanNodeModule('keytar', ['binding.gyp', 'build/**', 'src/**', 'script/**', 'node_modules/**'], ['**/*.node']))
			.pipe(util.cleanNodeModule('node-pty', ['binding.gyp', 'build/**', 'src/**', 'tools/**'], ['build/Release/*.exe', 'build/Release/*.dll', 'build/Release/*.node']))
			// {{SQL CARBON EDIT}}
			.pipe(util.cleanNodeModule('chart.js', ['node_modules/**'], undefined))
			.pipe(util.cleanNodeModule('emmet', ['node_modules/**'], undefined))
			.pipe(util.cleanNodeModule('pty.js', ['build/**'], ['build/Release/**']))
			.pipe(util.cleanNodeModule('jquery-ui', ['external/**', 'demos/**'], undefined))
			.pipe(util.cleanNodeModule('core-js', ['**/**'], undefined))
			.pipe(util.cleanNodeModule('slickgrid', ['node_modules/**', 'examples/**'], undefined))
			.pipe(util.cleanNodeModule('nsfw', ['binding.gyp', 'build/**', 'src/**', 'openpa/**', 'includes/**'], ['**/*.node', '**/*.a']))
			.pipe(util.cleanNodeModule('vscode-nsfw', ['binding.gyp', 'build/**', 'src/**', 'openpa/**', 'includes/**'], ['**/*.node', '**/*.a']))
			.pipe(util.cleanNodeModule('vsda', ['binding.gyp', 'README.md', 'build/**', '*.bat', '*.sh', '*.cpp', '*.h'], ['build/Release/vsda.node']))
			.pipe(createAsar(path.join(process.cwd(), 'node_modules'), ['**/*.node', '**/vscode-ripgrep/bin/*', '**/node-pty/build/Release/*'], 'app/node_modules.asar'));

		// {{SQL CARBON EDIT}}
		let copiedModules = gulp.src([
			'node_modules/jquery/**/*.*',
			'node_modules/reflect-metadata/**/*.*',
			'node_modules/slickgrid/**/*.*',
			'node_modules/underscore/**/*.*',
			'node_modules/zone.js/**/*.*',
			'node_modules/chart.js/**/*.*'
		], { base: '.', dot: true });

		let all = es.merge(
			packageJsonStream,
			productJsonStream,
			license,
			watermark,
			api,
			// {{SQL CARBON EDIT}}
			copiedModules,
			dataApi,
			sources,
			deps
		);

		if (platform === 'win32') {
			all = es.merge(all, gulp.src(['resources/win32/code_file.ico', 'resources/win32/code_70x70.png', 'resources/win32/code_150x150.png'], { base: '.' }));
		} else if (platform === 'linux') {
			all = es.merge(all, gulp.src('resources/linux/code.png', { base: '.' }));
		} else if (platform === 'darwin') {
			const shortcut = gulp.src('resources/darwin/bin/code.sh')
				.pipe(rename('bin/code'));

			all = es.merge(all, shortcut);
		}

		let result = all
			.pipe(util.skipDirectories())
			.pipe(util.fixWin32DirectoryPermissions())
			.pipe(electron(_.extend({}, config, { platform, arch, ffmpegChromium: true })))
			.pipe(filter(['**', '!LICENSE', '!LICENSES.chromium.html', '!version']));

		if (platform === 'win32') {
			result = es.merge(result, gulp.src('resources/win32/bin/code.js', { base: 'resources/win32' }));

			result = es.merge(result, gulp.src('resources/win32/bin/code.cmd', { base: 'resources/win32' })
				.pipe(replace('@@NAME@@', product.nameShort))
				.pipe(rename(function (f) { f.basename = product.applicationName; })));

			result = es.merge(result, gulp.src('resources/win32/bin/code.sh', { base: 'resources/win32' })
				.pipe(replace('@@NAME@@', product.nameShort))
				.pipe(rename(function (f) { f.basename = product.applicationName; f.extname = ''; })));

			result = es.merge(result, gulp.src('resources/win32/VisualElementsManifest.xml', { base: 'resources/win32' })
				.pipe(rename(product.nameShort + '.VisualElementsManifest.xml')));
		} else if (platform === 'linux') {
			result = es.merge(result, gulp.src('resources/linux/bin/code.sh', { base: '.' })
				.pipe(replace('@@NAME@@', product.applicationName))
				.pipe(rename('bin/' + product.applicationName)));
		}

		return result.pipe(vfs.dest(destination));
	};
}

const buildRoot = path.dirname(root);

// {{SQL CARBON EDIT}}
gulp.task('vscode-win32-x64-azurecore', ['optimize-vscode'], packageExtensionTask('azurecore', 'win32', 'x64'));
gulp.task('vscode-darwin-azurecore', ['optimize-vscode'], packageExtensionTask('azurecore', 'darwin'));
gulp.task('vscode-linux-x64-azurecore', ['optimize-vscode'], packageExtensionTask('azurecore', 'linux', 'x64'));

gulp.task('vscode-win32-x64-mssql', ['vscode-linux-x64-azurecore', 'optimize-vscode'], packageExtensionTask('mssql', 'win32', 'x64'));
gulp.task('vscode-darwin-mssql', ['vscode-linux-x64-azurecore', 'optimize-vscode'], packageExtensionTask('mssql', 'darwin'));
gulp.task('vscode-linux-x64-mssql', ['vscode-linux-x64-azurecore', 'optimize-vscode'], packageExtensionTask('mssql', 'linux', 'x64'));

gulp.task('clean-vscode-win32-ia32', util.rimraf(path.join(buildRoot, 'azuredatastudio-win32-ia32')));
gulp.task('clean-vscode-win32-x64', util.rimraf(path.join(buildRoot, 'azuredatastudio-win32-x64')));
gulp.task('clean-vscode-darwin', util.rimraf(path.join(buildRoot, 'azuredatastudio-darwin')));
gulp.task('clean-vscode-linux-ia32', util.rimraf(path.join(buildRoot, 'azuredatastudio-linux-ia32')));
gulp.task('clean-vscode-linux-x64', util.rimraf(path.join(buildRoot, 'azuredatastudio-linux-x64')));
gulp.task('clean-vscode-linux-arm', util.rimraf(path.join(buildRoot, 'azuredatastudio-linux-arm')));

gulp.task('vscode-win32-ia32', ['optimize-vscode', 'clean-vscode-win32-ia32'], packageTask('win32', 'ia32'));
gulp.task('vscode-win32-x64',  ['vscode-win32-x64-azurecore', 'vscode-win32-x64-mssql', 'optimize-vscode', 'clean-vscode-win32-x64'], packageTask('win32', 'x64'));
gulp.task('vscode-darwin', ['vscode-darwin-azurecore', 'vscode-darwin-mssql', 'optimize-vscode', 'clean-vscode-darwin'], packageTask('darwin'));
gulp.task('vscode-linux-ia32', ['optimize-vscode', 'clean-vscode-linux-ia32'], packageTask('linux', 'ia32'));
gulp.task('vscode-linux-x64', ['vscode-linux-x64-azurecore', 'vscode-linux-x64-mssql', 'optimize-vscode', 'clean-vscode-linux-x64'], packageTask('linux', 'x64'));
gulp.task('vscode-linux-arm', ['optimize-vscode', 'clean-vscode-linux-arm'], packageTask('linux', 'arm'));

gulp.task('vscode-win32-ia32-min', ['minify-vscode', 'clean-vscode-win32-ia32'], packageTask('win32', 'ia32', { minified: true }));
gulp.task('vscode-win32-x64-min', ['minify-vscode', 'clean-vscode-win32-x64'], packageTask('win32', 'x64', { minified: true }));
gulp.task('vscode-darwin-min', ['minify-vscode', 'clean-vscode-darwin'], packageTask('darwin', null, { minified: true }));
gulp.task('vscode-linux-ia32-min', ['minify-vscode', 'clean-vscode-linux-ia32'], packageTask('linux', 'ia32', { minified: true }));
gulp.task('vscode-linux-x64-min', ['minify-vscode', 'clean-vscode-linux-x64'], packageTask('linux', 'x64', { minified: true }));
gulp.task('vscode-linux-arm-min', ['minify-vscode', 'clean-vscode-linux-arm'], packageTask('linux', 'arm', { minified: true }));

// Transifex Localizations

const innoSetupConfig = {
	'zh-cn': { codePage: 'CP936', defaultInfo: { name: 'Simplified Chinese', id: '$0804', } },
	'zh-tw': { codePage: 'CP950', defaultInfo: { name: 'Traditional Chinese', id: '$0404' } },
	'ko': { codePage: 'CP949', defaultInfo: { name: 'Korean', id: '$0412' } },
	'ja': { codePage: 'CP932' },
	'de': { codePage: 'CP1252' },
	'fr': { codePage: 'CP1252' },
	'es': { codePage: 'CP1252' },
	'ru': { codePage: 'CP1251' },
	'it': { codePage: 'CP1252' },
	'pt-br': { codePage: 'CP1252' },
	'hu': { codePage: 'CP1250' },
	'tr': { codePage: 'CP1254' }
};

const apiHostname = process.env.TRANSIFEX_API_URL;
const apiName = process.env.TRANSIFEX_API_NAME;
const apiToken = process.env.TRANSIFEX_API_TOKEN;

gulp.task('vscode-translations-push', ['optimize-vscode'], function () {
	const pathToMetadata = './out-vscode/nls.metadata.json';
	const pathToExtensions = './extensions/*';
	const pathToSetup = 'build/win32/**/{Default.isl,messages.en.isl}';

	return es.merge(
		gulp.src(pathToMetadata).pipe(i18n.createXlfFilesForCoreBundle()),
		gulp.src(pathToSetup).pipe(i18n.createXlfFilesForIsl()),
		gulp.src(pathToExtensions).pipe(i18n.createXlfFilesForExtensions())
	).pipe(i18n.findObsoleteResources(apiHostname, apiName, apiToken)
	).pipe(i18n.pushXlfFiles(apiHostname, apiName, apiToken));
});

gulp.task('vscode-translations-push-test', ['optimize-vscode'], function () {
	const pathToMetadata = './out-vscode/nls.metadata.json';
	const pathToExtensions = './extensions/*';
	const pathToSetup = 'build/win32/**/{Default.isl,messages.en.isl}';

	return es.merge(
		gulp.src(pathToMetadata).pipe(i18n.createXlfFilesForCoreBundle()),
		gulp.src(pathToSetup).pipe(i18n.createXlfFilesForIsl()),
		gulp.src(pathToExtensions).pipe(i18n.createXlfFilesForExtensions())
	// {{SQL CARBON EDIT}}
	// disable since function makes calls to VS Code Transifex API
	// ).pipe(i18n.findObsoleteResources(apiHostname, apiName, apiToken)
	).pipe(vfs.dest('../vscode-transifex-input'));
});

gulp.task('vscode-translations-pull', function () {
	[...i18n.defaultLanguages, ...i18n.extraLanguages].forEach(language => {
		i18n.pullCoreAndExtensionsXlfFiles(apiHostname, apiName, apiToken, language).pipe(vfs.dest(`../vscode-localization/${language.id}/build`));

		let includeDefault = !!innoSetupConfig[language.id].defaultInfo;
		i18n.pullSetupXlfFiles(apiHostname, apiName, apiToken, language, includeDefault).pipe(vfs.dest(`../vscode-localization/${language.id}/setup`));
	});
});

gulp.task('vscode-translations-import', function () {
	[...i18n.defaultLanguages, ...i18n.extraLanguages].forEach(language => {
		gulp.src(`../vscode-localization/${language.id}/build/*/*.xlf`)
			.pipe(i18n.prepareI18nFiles())
			.pipe(vfs.dest(`./i18n/${language.folderName}`));

		// {{SQL CARBON EDIT}}
		// gulp.src(`../vscode-localization/${language.id}/setup/*/*.xlf`)
		// 	.pipe(i18n.prepareIslFiles(language, innoSetupConfig[language.id]))
		// 	.pipe(vfs.dest(`./build/win32/i18n`));
	});
});

// Sourcemaps

gulp.task('upload-vscode-sourcemaps', ['minify-vscode'], () => {
	const vs = gulp.src('out-vscode-min/**/*.map', { base: 'out-vscode-min' })
		.pipe(es.mapSync(f => {
			f.path = `${f.base}/core/${f.relative}`;
			return f;
		}));

	const extensions = gulp.src('extensions/**/out/**/*.map', { base: '.' });

	return es.merge(vs, extensions)
		.pipe(azure.upload({
			account: process.env.AZURE_STORAGE_ACCOUNT,
			key: process.env.AZURE_STORAGE_ACCESS_KEY,
			container: 'sourcemaps',
			prefix: commit + '/'
		}));
});

const allConfigDetailsPath = path.join(os.tmpdir(), 'configuration.json');
gulp.task('upload-vscode-configuration', ['generate-vscode-configuration'], () => {
	if (!shouldSetupSettingsSearch()) {
		const branch = process.env.BUILD_SOURCEBRANCH;
		console.log(`Only runs on master and release branches, not ${branch}`);
		return;
	}

	if (!fs.existsSync(allConfigDetailsPath)) {
		throw new Error(`configuration file at ${allConfigDetailsPath} does not exist`);
	}

	const settingsSearchBuildId = getSettingsSearchBuildId(packageJson);
	if (!settingsSearchBuildId) {
		throw new Error('Failed to compute build number');
	}

	return gulp.src(allConfigDetailsPath)
		.pipe(azure.upload({
			account: process.env.AZURE_STORAGE_ACCOUNT,
			key: process.env.AZURE_STORAGE_ACCESS_KEY,
			container: 'configuration',
			prefix: `${settingsSearchBuildId}/${commit}/`
		}));
});

function shouldSetupSettingsSearch() {
	const branch = process.env.BUILD_SOURCEBRANCH;
	return branch && (/\/master$/.test(branch) || branch.indexOf('/release/') >= 0);
}

function getSettingsSearchBuildId(packageJson) {
	try {
		const branch = process.env.BUILD_SOURCEBRANCH;
		const branchId = branch.indexOf('/release/') >= 0 ? 0 :
			/\/master$/.test(branch) ? 1 :
			2; // Some unexpected branch

		const out = cp.execSync(`git rev-list HEAD --count`);
		const count = parseInt(out.toString());

		// <version number><commit count><branchId (avoid unlikely conflicts)>
		// 1.25.1, 1,234,567 commits, master = 1250112345671
		return util.versionStringToNumber(packageJson.version) * 1e8 + count * 10 + branchId;
	} catch (e) {
		throw new Error('Could not determine build number: ' + e.toString());
	}
}

// This task is only run for the MacOS build
gulp.task('generate-vscode-configuration', () => {
	return new Promise((resolve, reject) => {
		const buildDir = process.env['AGENT_BUILDDIRECTORY'];
		if (!buildDir) {
			return reject(new Error('$AGENT_BUILDDIRECTORY not set'));
		}

		if (process.env.VSCODE_QUALITY !== 'insider' && process.env.VSCODE_QUALITY !== 'stable') {
			return resolve();
		}

		const userDataDir = path.join(os.tmpdir(), 'tmpuserdata');
		const extensionsDir = path.join(os.tmpdir(), 'tmpextdir');
		const appName = process.env.VSCODE_QUALITY === 'insider' ? 'Visual\\ Studio\\ Code\\ -\\ Insiders.app' : 'Visual\\ Studio\\ Code.app';
		const appPath = path.join(buildDir, `VSCode-darwin/${appName}/Contents/Resources/app/bin/code`);
		const codeProc = cp.exec(`${appPath} --export-default-configuration='${allConfigDetailsPath}' --wait --user-data-dir='${userDataDir}' --extensions-dir='${extensionsDir}'`);

		const timer = setTimeout(() => {
			codeProc.kill();
			reject(new Error('export-default-configuration process timed out'));
		}, 10 * 1000);

		codeProc.stdout.on('data', d => console.log(d.toString()));
		codeProc.stderr.on('data', d => console.log(d.toString()));

		codeProc.on('exit', () => {
			clearTimeout(timer);
			resolve();
		});

		codeProc.on('error', err => {
			clearTimeout(timer);
			reject(err);
		});
	});
});

// {{SQL CARBON EDIT}}
// Install service locally before building carbon

function installService() {
	let config = require('../extensions/mssql/src/config.json');
	return platformInfo.getCurrent().then(p => {
		let runtime = p.runtimeId;
		// fix path since it won't be correct
		config.installDirectory = path.join(__dirname, '../extensions/mssql/src', config.installDirectory);
		var installer = new serviceDownloader(config);
		let serviceInstallFolder = installer.getInstallDirectory(runtime);
		console.log('Cleaning up the install folder: ' + serviceInstallFolder);
		return del(serviceInstallFolder + '/*').then(() => {
			console.log('Installing the service. Install folder: ' + serviceInstallFolder);
			return installer.installService(runtime);
		}, delError => {
			console.log('failed to delete the install folder error: ' + delError);
		});
	});
}

gulp.task('install-sqltoolsservice', () => {
    return installService();
});

