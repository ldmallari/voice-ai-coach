/**
 * Knowledge retrieval workflow.
 *
 * POST { query } -> embeds with Cohere -> similarity search over the Supabase
 * vector store -> returns the closest clinic-document passages.
 *
 * The app calls this rather than embedding anything itself, so n8n stays the
 * orchestration layer and the app holds no embedding credential.
 */
import { workflow, node, trigger, embedding, newCredential } from '@n8n/workflow-sdk';

// Pinned to embed-english-v3.0 (1024 dims). The node defaults to v2.0, which is
// 4096 dims and will not fit the schema's vector(1024) column.
const cohereEmbeddings = embedding({
  type: '@n8n/n8n-nodes-langchain.embeddingsCohere',
  version: 1,
  config: {
    name: 'Cohere Embeddings',
    parameters: { modelName: 'embed-english-v3.0' },
    credentials: { cohereApi: newCredential('Cohere') },
    position: [560, 520],
  },
});

const retrieveWebhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Retrieve Request',
    parameters: {
      httpMethod: 'POST',
      path: 'coach-retrieve',
      responseMode: 'responseNode',
    },
    position: [240, 300],
  },
  output: [{ body: { query: 'What does our cancellation policy say?' } }],
});

const searchDocuments = node({
  type: '@n8n/n8n-nodes-langchain.vectorStoreSupabase',
  version: 1.3,
  config: {
    name: 'Search Clinic Documents',
    parameters: {
      mode: 'load',
      tableName: { __rl: true, mode: 'id', value: 'documents' },
      prompt: '={{ $json.body.query }}',
      topK: 5,
      includeDocumentMetadata: true,
      options: { queryName: 'match_documents' },
    },
    credentials: { supabaseApi: newCredential('Supabase') },
    subnodes: { embedding: cohereEmbeddings },
    position: [560, 300],
  },
  output: [
    {
      document: { pageContent: 'Late cancellations incur a 50% fee.', metadata: {} },
      score: 0.82,
    },
  ],
});

const respond = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Return Matches',
    parameters: {
      respondWith: 'allIncomingItems',
      options: { responseKey: 'matches' },
    },
    position: [880, 300],
  },
});

export default workflow('coach-retrieval', 'Voice AI Coach - Knowledge Retrieval')
  .add(retrieveWebhook)
  .to(searchDocuments)
  .to(respond);
