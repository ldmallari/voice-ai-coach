/**
 * Knowledge ingest workflow.
 *
 * POST { title, text } -> splits into overlapping chunks -> embeds each with
 * Cohere -> inserts into the Supabase vector store with the document title as
 * metadata, so retrieved passages can be attributed to a source.
 */
import {
  workflow,
  node,
  trigger,
  embedding,
  documentLoader,
  textSplitter,
  newCredential,
} from '@n8n/workflow-sdk';

// Same model and dimensions as retrieval. A mismatch here would poison the index
// silently: inserts would succeed and searches would return nothing useful.
const cohereEmbeddings = embedding({
  type: '@n8n/n8n-nodes-langchain.embeddingsCohere',
  version: 1,
  config: {
    name: 'Cohere Embeddings',
    parameters: { modelName: 'embed-english-v3.0' },
    credentials: { cohereApi: newCredential('Cohere') },
    position: [560, 560],
  },
});

const splitter = textSplitter({
  type: '@n8n/n8n-nodes-langchain.textSplitterRecursiveCharacterTextSplitter',
  version: 1,
  config: {
    name: 'Chunk Document',
    parameters: { chunkSize: 1000, chunkOverlap: 150 },
    position: [880, 720],
  },
});

const loader = documentLoader({
  type: '@n8n/n8n-nodes-langchain.documentDefaultDataLoader',
  version: 1.1,
  config: {
    name: 'Load Document Text',
    parameters: {
      dataType: 'json',
      jsonMode: 'expressionData',
      jsonData: '={{ $json.body.text }}',
      textSplittingMode: 'custom',
      options: {
        metadata: {
          metadataValues: [{ name: 'title', value: '={{ $json.body.title }}' }],
        },
      },
    },
    subnodes: { textSplitter: splitter },
    position: [780, 560],
  },
});

const ingestWebhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Ingest Request',
    parameters: {
      httpMethod: 'POST',
      path: 'coach-ingest',
      responseMode: 'responseNode',
    },
    position: [240, 300],
  },
  output: [
    {
      body: {
        title: 'Consultation SOP',
        text: 'Always confirm pricing before the consultation ends.',
      },
    },
  ],
});

const insertDocuments = node({
  type: '@n8n/n8n-nodes-langchain.vectorStoreSupabase',
  version: 1.3,
  config: {
    name: 'Store Document Chunks',
    parameters: {
      mode: 'insert',
      tableName: { __rl: true, mode: 'id', value: 'documents' },
      embeddingBatchSize: 200,
      options: { queryName: 'match_documents' },
    },
    credentials: { supabaseApi: newCredential('Supabase') },
    subnodes: { embedding: cohereEmbeddings, documentLoader: loader },
    position: [560, 300],
  },
  output: [{ success: true }],
});

const respond = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Confirm Ingest',
    parameters: {
      respondWith: 'json',
      responseBody: '={{ JSON.stringify({ ok: true, title: $(\'Ingest Request\').item.json.body.title }) }}',
    },
    position: [880, 300],
  },
});

export default workflow('coach-ingest', 'Voice AI Coach - Knowledge Ingest')
  .add(ingestWebhook)
  .to(insertDocuments)
  .to(respond);
