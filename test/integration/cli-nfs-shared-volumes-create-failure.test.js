/* * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

//
// Summary:
//
// These tests ensure that when provisioning fails for a volapi storage VM, we
// get an error message from sdc-docker rather than a message telling us the
// creation was successful. We "break" provisioning for the 10g package by
// setting at trait which no CNs will have. The provision will then fail at
// the workflow job when we're trying to allocate a CN.
//

var assert = require('assert-plus');
var common = require('../lib/common');
var mod_testVolumes = require('../lib/volumes');

assert.string(process.env.DOCKER_CLI_VERSION, 'process.env.DOCKER_CLI_VERSION');

var dockerVersion = common.parseDockerVersion(process.env.DOCKER_CLI_VERSION);
if (dockerVersion.major < 1 || dockerVersion.minor < 9) {
    console.log('Skipping volume tests: volumes are not supported in Docker '
        + 'versions < 1.9');
    process.exit(0);
}

if (!mod_testVolumes.nfsSharedVolumesSupported()) {
    console.log('Skipping volume tests: volumes are not supported in this '
        + 'Triton setup');
    process.exit(0);
}

var test = require('tape');

var cli = require('../lib/cli');
var h = require('./helpers');
var volumesCli = require('../lib/volumes-cli');

var createTestVolume = mod_testVolumes.createTestVolume;

var NFS_SHARED_VOLUME_NAMES_PREFIX =
    mod_testVolumes.getNfsSharedVolumesNamePrefix();

var ALICE_USER;
var PAPI;
var PAPI_PACKAGE;
var PAPI_ORIGINAL_TRAITS;

test('setup', function (tt) {
    tt.test('DockerEnv: alice init', function (t) {
        cli.init(t, function onCliInit(err, env) {
            t.ifErr(err, 'Docker environment initialization should not err');
            if (env) {
                ALICE_USER = env.user;
            }
        });
    });

    tt.test('setup PAPI client', function (t) {
        h.createPapiClient(function (err, _papi) {
            t.ifErr(err, 'create PAPI client');
            PAPI = _papi;
            t.end();
        });
    });

    tt.test('getting 10g PAPI package', function (t) {
        PAPI.list('(&(name=sdc_volume_nfs_10)(active=true))',
            {},
            function _onResults(err, pkgs, count) {
                var results = [];
                t.ifErr(err, 'get PAPI package');
                if (pkgs) {
                    results = pkgs.map(function mapUuids(pkg) {
                        return pkg.uuid;
                    });
                }
                t.equal(count, 1, 'should be 1 result ' + JSON.stringify(results));
                if (count === 1 && results.length === 1) {
                    PAPI_PACKAGE = results[0];
                    PAPI_ORIGINAL_TRAITS = pkgs[0].traits;
                }
                t.end();
            }
         );
    });

    tt.test('breaking provisioning w/ 10g package', function (t) {
        PAPI.update(PAPI_PACKAGE, {traits: {broken_by_docker_tests: true}}, {},
            function onUpdated(err) {
                t.ifErr(err, 'update PAPI setting broken traits');
                t.end();
            }
        );
    });
});

test('Volume creation should fail when provision fails', function (tt) {
    var testVolumeName =
        common.makeResourceName(NFS_SHARED_VOLUME_NAMES_PREFIX);

    tt.test('creating volume ' + testVolumeName + ' should fail with '
        + 'appropriate error message',
        function (t) {
            volumesCli.createTestVolume(ALICE_USER, {
                size: '10g',
                name: testVolumeName
            }, function volumeCreated(err, stdout, stderr) {
                var expectedErr = 'Error response from daemon: (InternalError) '
                    + 'volume creation failed';
                var matches;
                var re = new RegExp(expectedErr.replace(/[()]/g, '\\$&'));

                matches = stderr.match(re);

                t.ok(err, 'volume creation should not succeed');
                // with this, we get the actual error message if it fails
                t.equal((matches ? matches[0] : stderr), expectedErr,
                    'expected InternalError');

                t.end();
            });
        }
    );
});

test('teardown', function (tt) {
    tt.test('un-breaking provisioning w/ 10g package', function (t) {
        var newTraits = {};

        if (PAPI_ORIGINAL_TRAITS) {
            newTraits = PAPI_ORIGINAL_TRAITS;
        }

        PAPI.update(PAPI_PACKAGE, {traits: newTraits}, {},
            function onUpdated(err) {
                t.ifErr(err, 'update PAPI setting original traits: '
                    + JSON.stringify(newTraits));
                t.end();
            }
        );
    });
});
