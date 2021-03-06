import { Injectable } from '@angular/core';
import { Http, Response } from '@angular/http';

import { AdminService } from './admin.service';
import { ClientService } from './client.service';
import { AlertService } from './alert.service';
import { ConnectionProfileService } from './connectionprofile.service';
import { WalletService } from './wallet.service';
import { SampleBusinessNetworkService } from './samplebusinessnetwork.service';

const fabricComposerOwner = 'hyperledger';
const fabricComposerRepository = 'composer-sample-networks';

@Injectable()
export class InitializationService {

    private initializingPromise: Promise<any> = null;
    private initialized = false;

    private config;

    constructor(private adminService: AdminService,
                private clientService: ClientService,
                private sampleBusinessNetworkService: SampleBusinessNetworkService,
                private alertService: AlertService,
                private connectionProfileService: ConnectionProfileService,
                private walletService: WalletService,
                private http: Http) {
    }

    initialize(): Promise<any> {
        if (this.initialized) {
            return Promise.resolve();
        } else if (this.initializingPromise) {
            return this.initializingPromise;
        }

        this.initializingPromise = Promise.resolve()
        .then(() => {
            return this.loadConfig();
        })
        .then((config) => {
            this.config = config;
            return this.createInitialProfiles();
        })
        .then(() => {
            return this.createInitialIdentities();
        })
        .then(() => {
            this.alertService.busyStatus$.next({title: 'Establishing admin connection', text: 'Using the connection profile ' + this.connectionProfileService.getCurrentConnectionProfile()});
            return this.adminService.ensureConnected();
        })
        .then(() => {
            this.alertService.busyStatus$.next({title: 'Establishing client connection', text: 'Using the connection profile ' + this.connectionProfileService.getCurrentConnectionProfile()});
            return this.clientService.ensureConnected();
        })
        .then(() => {
            if (this.adminService.isInitialDeploy()) {
                return this.sampleBusinessNetworkService.deployInitialSample();
            }
        })
        .then(() => {
            this.alertService.busyStatus$.next(null);
            this.initialized = true;
            this.initializingPromise = null;
        })
        .catch((error) => {
            this.alertService.busyStatus$.next(null);
            this.alertService.errorStatus$.next(error);
            this.initialized = false;
            this.initializingPromise = null;
        });

        return this.initializingPromise;
    }

    loadConfig(): Promise<any> {
        // Load the config data.
        return this.http.get('/config.json')
        .map((res: Response) => res.json())
        .toPromise();
    }

    createInitialProfiles() {
        return this.connectionProfileService.createDefaultProfile()
        .then(() => {
            // Create all of the connection profiles specified in the configuration.
            let connectionProfiles = {};
            if (this.config && this.config.connectionProfiles) {
                connectionProfiles = this.config.connectionProfiles;
            }
            const connectionProfileNames = Object.keys(connectionProfiles).sort();
            return connectionProfileNames.reduce((result, connectionProfileName) => {
                return result.then(() => {
                    console.log('Checking for connection profile', connectionProfileName);
                    return this.connectionProfileService.getProfile(connectionProfileName)
                    .catch((error) => {
                        console.log('Connection profile does not exist, creating');
                        return this.connectionProfileService.createProfile(connectionProfileName, connectionProfiles[connectionProfileName]);
                    });
                });
            }, Promise.resolve());
        });
    }

    createInitialIdentities() {
        let credentials = {};
        if (this.config && this.config.credentials) {
            credentials = this.config.credentials;
        }
        const connectionProfileNames = Object.keys(credentials).sort();
        return connectionProfileNames.reduce((result, connectionProfileName) => {
            return result.then(() => {
                console.log('Creating credentials for connection profile', connectionProfileName);
                return this.walletService.getWallet(connectionProfileName);
            })
            .then((wallet) => {
                const connectionProfileCredentials = credentials[connectionProfileName];
                const credentialNames = Object.keys(connectionProfileCredentials).sort();
                return credentialNames.reduce((result2, credentialName) => {
                    return wallet.get(credentialName)
                    .catch((error) => {
                        console.log('Adding credential', credentialName);
                        return wallet.add(credentialName, connectionProfileCredentials[credentialName]);
                    });
                }, Promise.resolve());
            });
        }, Promise.resolve());
    }

    isWebOnly(): boolean {
        if (!this.config) {
            return false;
        }
        return this.config.webonly;
    }
}
