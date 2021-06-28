import * as fs from 'fs';
import * as path from 'path';
import * as core from '@actions/core';
import * as github from '@actions/github';
import * as xmlbuilder from 'xmlbuilder';
import * as xmlParser from 'fast-xml-parser';
import {ProcessEnvOptions} from 'child_process';

export function configAuthentication(
  feedUrl: string,
  existingFileLocation: string = '',
  processRoot: string = process.cwd()
) {
  const existingNuGetConfig: string = path.resolve(
    processRoot,
    existingFileLocation === ''
      ? getExistingNugetConfig(processRoot)
      : existingFileLocation
  );

  const tempNuGetConfig: string = path.resolve(
    processRoot,
    '../',
    'nuget.config'
  );

  writeFeedToFile(feedUrl, existingNuGetConfig, tempNuGetConfig);
}

function isValidKey(key: string): boolean {
  return /^[\w\-\.]+$/i.test(key);
}

function getExistingNugetConfig(processRoot: string) {
  const defaultConfigName = 'nuget.config';
  const configFileNames = fs
    .readdirSync(processRoot)
    .filter(filename => filename.toLowerCase() === defaultConfigName);
  if (configFileNames.length) {
    return configFileNames[0];
  }
  return defaultConfigName;
}

function writeFeedToFile(
  feedUrl: string,
  existingFileLocation: string,
  tempFileLocation: string
) {
  console.log(
    `dotnet-auth: Finding any source references in ${existingFileLocation}, writing a new temporary configuration file with credentials to ${tempFileLocation}`
  );
  let xml: xmlbuilder.XMLElement;
  let sourceKeys: string[] = [];
  let owner: string = core.getInput('owner');
  let sourceUrl: string = feedUrl;
  if (!owner) {
    owner = github.context.repo.owner;
  }

  if (!process.env.NUGET_AUTH_TOKEN || process.env.NUGET_AUTH_TOKEN == '') {
    throw new Error(
      'The NUGET_AUTH_TOKEN environment variable was not provided. In this step, add the following: \r\nenv:\r\n  NUGET_AUTH_TOKEN: ${{secrets.GITHUB_TOKEN}}'
    );
  }

  if (fs.existsSync(existingFileLocation)) {
    // get key from existing NuGet.config so NuGet/dotnet can match credentials
    const curContents: string = fs.readFileSync(existingFileLocation, 'utf8');
    var json = xmlParser.parse(curContents, {ignoreAttributes: false});

    if (typeof json.configuration == 'undefined') {
      throw new Error(`The provided NuGet.config seems invalid.`);
    }
    if (typeof json.configuration.packageSources != 'undefined') {
      if (typeof json.configuration.packageSources.add != 'undefined') {
        // file has at least one <add>
        if (typeof json.configuration.packageSources.add[0] == 'undefined') {
          // file has only one <add>
          if (
            json.configuration.packageSources.add['@_value']
              .toLowerCase()
              .includes(feedUrl.toLowerCase())
          ) {
            let key = json.configuration.packageSources.add['@_key'];
            sourceKeys.push(key);
            core.debug(`Found a URL with key ${key}`);
          }
        } else {
          // file has 2+ <add>
          for (
            let i = 0;
            i < json.configuration.packageSources.add.length;
            i++
          ) {
            const source = json.configuration.packageSources.add[i];
            const value = source['@_value'];
            core.debug(`source '${value}'`);
            if (value.toLowerCase().includes(feedUrl.toLowerCase())) {
              let key = source['@_key'];
              sourceKeys.push(key);
              core.debug(`Found a URL with key ${key}`);
            }
          }
        }
      }
    }
  }

  xml = xmlbuilder
    .create('configuration')
    .ele('config')
    .ele('add', {key: 'defaultPushSource', value: sourceUrl})
    .up()
    .up();

  if (sourceKeys.length == 0) {
    let keystring = 'Source';
    xml = xml
      .ele('packageSources')
      .ele('add', {key: keystring, value: sourceUrl})
      .up()
      .up();
    sourceKeys.push(keystring);
  }
  xml = xml.ele('packageSourceCredentials');

  sourceKeys.forEach(key => {
    if (!isValidKey(key)) {
      throw new Error(
        "Source name can contain letters, numbers, and '-', '_', '.' symbols only. Please, fix source name in NuGet.config and try again."
      );
    }

    xml = xml
      .ele(key)
      .ele('add', {key: 'Username', value: owner})
      .up()
      .ele('add', {
        key: 'ClearTextPassword',
        value: process.env.NUGET_AUTH_TOKEN
      })
      .up()
      .up();
  });

  // If NuGet fixes itself such that on Linux it can look for environment variables in the config file (it doesn't seem to work today),
  // use this for the value above
  //           process.platform == 'win32'
  //             ? '%NUGET_AUTH_TOKEN%'
  //             : '$NUGET_AUTH_TOKEN'

  var output = xml.end({pretty: true});
  fs.writeFileSync(tempFileLocation, output);
}
