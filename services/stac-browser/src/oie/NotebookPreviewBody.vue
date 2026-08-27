<template>
  <div class="notebook-preview-body">
    <div v-if="loading" class="notebook-preview-status">
      <b-spinner small /> {{ $t('loading') }}
    </div>
    <b-alert v-else-if="error" show variant="danger" class="mb-0">
      {{ error }}
    </b-alert>
    <div v-show="!loading && !error" ref="notebookTarget" class="notebook-preview-target" />
  </div>
</template>

<script>
import { marked } from 'marked';
import Prism from 'prismjs';
import katex from 'katex';
import { nbv_constructor } from './nbviewer/nbv.js';
import { stacRequestOptions } from '../store/utils';
import 'katex/dist/katex.min.css';
import 'prismjs/themes/prism.css';

const nbv = nbv_constructor(document, {
  katex,
  prism: Prism,
  marked
});

export default {
  name: 'NotebookPreviewBody',
  props: {
    asset: {
      type: Object,
      required: true
    },
    href: {
      type: String,
      required: true
    }
  },
  data() {
    return {
      loading: true,
      error: null
    };
  },
  mounted() {
    this.loadNotebook();
  },
  methods: {
    async loadNotebook() {
      this.loading = true;
      this.error = null;
      if (this.$refs.notebookTarget) {
        this.$refs.notebookTarget.innerHTML = '';
      }

      try {
        const link = Object.assign({}, this.asset, { href: this.href, type: this.asset.type });
        const options = stacRequestOptions(this.$store, link);
        const fetchOptions = {
          method: options.method || 'get',
          headers: options.headers
        };
        if (options.body) {
          fetchOptions.body = options.body;
        }

        const response = await fetch(options.url, fetchOptions);
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`.trim());
        }

        const notebook = await response.json();
        await this.$nextTick();
        if (!this.$refs.notebookTarget) {
          return;
        }
        nbv.render(notebook, this.$refs.notebookTarget);
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
      } finally {
        this.loading = false;
      }
    }
  }
};
</script>

<style lang="scss">
#stac-browser {
  .notebook-preview-body {
    height: 100%;
    overflow: auto;
  }

  .notebook-preview-status {
    padding: 1rem;
    text-align: center;
  }

  .notebook-preview-target {
    min-height: 100%;
    padding: 0.5rem;
  }
}
</style>
