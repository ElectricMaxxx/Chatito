#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import * as rasa from './adapters/rasa';
import * as snips from './adapters/snips';
import * as gen from './main';
import { ISentenceTokens, IUtteranceWriter } from './types';

// tslint:disable-next-line:no-var-requires
const argv = require('minimist')(process.argv.slice(2));

const workingDirectory = process.cwd();
const getExampleFilePath = (filename: string) => path.resolve(workingDirectory, filename);

const writeFileStreams = (dir: string) => {
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir); }
    let openWriteStreams: { [key: string]: fs.WriteStream } = {};
    const writeStream: IUtteranceWriter = (u: ISentenceTokens[], intentKey: string, n: number) => {
        let writer: fs.WriteStream;
        if (openWriteStreams[intentKey]) {
            writer = openWriteStreams[intentKey];
        } else {
            writer = fs.createWriteStream(path.resolve(dir, `${intentKey}.ndjson`));
            openWriteStreams[intentKey] = writer;
        }
        writer.write(JSON.stringify(u) + '\n');
    };
    const closeStreams = () => {
        Object.keys(openWriteStreams).forEach((k) => openWriteStreams[k].end());
        openWriteStreams = {};
    };
    return { writeStream, closeStreams };
};

(async () => {
    if (!argv._ || !argv._.length) {
        // tslint:disable-next-line:no-console
        console.error('Invalid chatito file.');
        process.exit(1);
    }
    const configFile = argv._[0];
    const format = (argv.format || 'default').toLowerCase();
    if (['default', 'rasa', 'snips'].indexOf(format) === -1) {
        // tslint:disable-next-line:no-console
        console.error(`Invalid format argument: ${format}`);
        process.exit(1);
    }
    try {
        // parse the formatOptions argument
        const dslFilePath = getExampleFilePath(configFile);
        const file = fs.readFileSync(dslFilePath, 'utf8');
        const splittedPath = path.posix.basename(dslFilePath).split('.');
        if (!splittedPath.length || 'chatito' !== splittedPath[splittedPath.length - 1].toLowerCase()) {
            throw new Error('Invalid filename extension.');
        }
        const keyName = path.basename(dslFilePath, '.chatito');
        if (format === 'default') {
            const directory = path.resolve(path.dirname(dslFilePath), keyName);
            const fileWriterStreams = writeFileStreams(directory);
            const fullDataset = await gen.datasetFromString(file, fileWriterStreams.writeStream);
            // tslint:disable-next-line:no-console
            console.log(`DONE! - Examples generated by intent at ${directory} directory`);
            fileWriterStreams.closeStreams();
        } else {
            let formatOptions = null;
            if (argv.formatOptions) {
                formatOptions = JSON.parse(fs.readFileSync(path.resolve(argv.formatOptions), 'utf8'));
            }
            const adapter = format === 'rasa' ? rasa : snips;
            const fullDataset = await adapter.adapter(file, formatOptions);
            const trainingJsonFileName = splittedPath.slice(0, splittedPath.length - 1)
                .concat([`_${format}.json`]).join('');
            const trainingJsonFilePath = path.resolve(path.dirname(dslFilePath), trainingJsonFileName);
            fs.writeFileSync(trainingJsonFilePath, JSON.stringify(fullDataset, null, 1));
        }
    } catch (e) {
        // tslint:disable:no-console
        if (e && e.message && e.location) {
            console.log('==== CHATITO SYNTAX ERROR ====');
            console.log('    ', e.message);
            console.log(`     Line: ${e.location.start.line}, Column: ${e.location.start.column}`);
            console.log('==============================');
        } else { console.error(e && e.stack ? e.stack : e); }
        console.log('FULL ERROR REPORT:');
        console.error(e);
        // tslint:enable:no-console
        process.exit(1);
    }
})();
