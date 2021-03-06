/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {CallConfig, IndexedInput, Input, LitMetadata, Preds} from '../lib/types';

import {LitService} from './lit_service';
import {StatusService} from './status_service';

/**
 * API service singleton, responsible for actually making calls to the server
 * and (as best it can) enforcing type safety on returned values.
 */
export class ApiService extends LitService {
  constructor(private readonly statusService: StatusService) {
    super();
  }

  /**
   * Send a request to the server to get inputs for a dataset.
   * @param dataset name of dataset to load
   */
  getInputs = async(dataset: string): Promise<IndexedInput[]> => {
    const loadMessage = 'Loading inputs';
    const inputResponse = await this.queryServer(
        '/get_dataset', {'dataset_name': dataset}, [], loadMessage);
    const toProcess = ensureArrayData(inputResponse);
    return toProcess.map((data, index) => {
      return {
        data: data.data,
        id: data.id,
        meta: {added: 0, isFavorited: false}
      };
    });
  };

  /**
   * Send a request to the server to get dataset info.
   */
  getInfo = async():
      Promise<LitMetadata> => {
        const loadMessage = 'Loading metadata';
        return this.queryServer<LitMetadata>('/get_info', {}, [], loadMessage);
      }

  /**
   * Calls the server to get predictions of the given types.
   * @param inputs inputs to run model on
   * @param model model to query
   * @param datasetName current dataset (for caching)
   * @param requestedTypes datatypes to request
   * @param loadMessage optional loading message to display in toolbar
   */
  getPreds(
      inputs: IndexedInput[], model: string, datasetName: string,
      requestedTypes: string[], loadMessage?: string): Promise<Preds[]> {
    loadMessage = loadMessage || 'Fetching predictions';
    return this.queryServer(
        '/get_preds', {
          'model': model,
          'dataset_name': datasetName,
          'requested_types': requestedTypes.join(','),
        },
        inputs, loadMessage);
  }

  /**
   * Calls the server to get newly generated inputs for a set of inputs, for a
   * given generator and model.
   * @param inputs inputs to run on
   * @param modelName model to query
   * @param datasetName current dataset
   * @param generator generator being used
   * @param config: configuration to send to backend (optional)
   * @param loadMessage: loading message to show to user (optional)
   */
  getGenerated(
      inputs: IndexedInput[], modelName: string, datasetName: string,
      generator: string, config?: CallConfig,
      loadMessage?: string): Promise<Input[][]> {
    loadMessage = loadMessage ?? 'Loading generator output';
    return this.queryServer(
        '/get_generated', {
          'model': modelName,
          'dataset_name': datasetName,
          'generator': generator,
        },
        inputs, loadMessage, config);
  }

  /**
   * Calls the server to create and set the IDs for the provided inputs.
   * @param inputs Inputs to get the IDs for.
   * @return Inputs with the IDs correctly set.
   */
  getDatapointIds(inputs: IndexedInput[]): Promise<IndexedInput[]> {
    return this.queryServer('/get_datapoint_ids', {}, inputs);
  }

  /**
   * Calls the server to run an interpretation component.
   * @param inputs inputs to run on
   * @param modelName model to query
   * @param datasetName current dataset (for caching)
   * @param interpreterName interpreter to run
   * @param config: configuration to send to backend (optional)
   * @param loadMessage: loading message to show to user (optional)
   */
  getInterpretations(
      inputs: IndexedInput[], modelName: string, datasetName: string,
      interpreterName: string, config?: CallConfig,
      // tslint:disable-next-line:no-any
      loadMessage?: string): Promise<any> {
    loadMessage = loadMessage ?? 'Fetching interpretations';
    return this.queryServer(
        '/get_interpretations', {
          'model': modelName,
          'dataset_name': datasetName,
          'interpreter': interpreterName,
        },
        inputs, loadMessage, config);
  }

  /**
   * Calls the server to save new datapoints.
   * @param inputs Text inputs to persist.
   * @param datasetName dataset being used.
   * @param path path to save to.
   */
  saveDatapoints(inputs: IndexedInput[], datasetName: string, path: string):
      Promise<string> {
    const loadMessage = 'Saving new datapoints';
    return this.queryServer(
        '/save_datapoints', {
          'dataset_name': datasetName,
          path,
        },
        inputs, loadMessage);
  }

  /**
   * Calls the server to load persisted datapoints.
   * @param datasetName dataset being used,
   * @param path path to load from.
   */
  loadDatapoints(datasetName: string, path: string): Promise<IndexedInput[]> {
    const loadMessage = 'Loading new datapoints';
    return this.queryServer(
        '/load_datapoints', {
          'dataset_name': datasetName,
          path,
        },
        [], loadMessage);
  }

  /**
   * Send a standard request to the server.
   * @param endpoint server endpoint, like /get_preds
   * @param params query params
   * @param inputs input examples
   */
  private async queryServer<T>(
      endpoint: string, params: {[key: string]: string}, inputs: IndexedInput[],
      loadMessage: string = '', config?: CallConfig): Promise<T> {
    const finished = this.statusService.startLoading(loadMessage);
    try {
      const paramsArray =
          Object.keys(params).map((key: string) => `${key}=${params[key]}`);
      const url = encodeURI(`${endpoint}?${paramsArray.join('&')}`);
      const body = JSON.stringify({inputs, config});
      const res = await fetch(url, {method: 'POST', body});
      // If there is tsserver error, the response contains text (not json).
      if (!res.ok) {
        const text = await res.text();
        throw (new Error(text));
      }
      const json = await res.json();
      finished();
      return json;
    } catch (err) {
      finished();
      // Extract error text if returned from tsserver.
      const found = err.message.match('(?<=<code>).*?(?=<br><br>)');
      if (!found) {
        this.statusService.addError('Unknown error');
      } else {
        this.statusService.addError(found[0]);
      }
      // TODO(b/156624955) Catch this error and console.log instead.
      throw (err);
    }
  }
}

// tslint:disable-next-line:no-any
function ensureArrayData(input: any) {
  return input && input instanceof Array ? input : [];
}
