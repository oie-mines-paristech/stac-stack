<template>
  <PreviewShell
    variant="notebook"
    :expanded="expanded"
    :height="height"
    @update:expanded="$emit('update:expanded', $event)"
  >
    <template #default="{ contentKey }">
      <b-alert v-if="requiresAuth" show variant="warning" class="mb-0">
        {{ $t('authentication.required') }}
      </b-alert>
      <NotebookPreviewBody
        v-else-if="canLoad"
        :key="contentKey"
        :asset="asset"
        :href="absoluteHref"
      />
    </template>
  </PreviewShell>
</template>

<script>
import { mapGetters } from 'vuex';
import { browserProtocols } from 'stac-js/src/http';
import PreviewShell from './PreviewShell.vue';
import { getPreviewHeight } from './previewAssets.js';
import NotebookPreviewBody from './NotebookPreviewBody.vue';

export default {
  name: 'NotebookPreviewPanel',
  components: {
    NotebookPreviewBody,
    PreviewShell
  },
  props: {
    asset: {
      type: Object,
      required: true
    },
    auth: {
      type: Array,
      default: () => ([])
    },
    expanded: {
      type: Boolean,
      default: false
    }
  },
  computed: {
    ...mapGetters(['getRequestUrl']),
    ...mapGetters('auth', ['isLoggedIn']),
    height() {
      return getPreviewHeight(this.asset);
    },
    requiresAuth() {
      return !this.isLoggedIn && this.auth.length > 0;
    },
    absoluteHref() {
      if (typeof this.asset.href !== 'string') {
        return null;
      }
      return this.getRequestUrl(this.asset.getAbsoluteUrl());
    },
    protocol() {
      if (typeof this.absoluteHref !== 'string') {
        return null;
      }
      const match = this.absoluteHref.match(/^(\w+):\/\//);
      return match ? match[1].toLowerCase() : null;
    },
    isBrowserProtocol() {
      return !this.protocol || browserProtocols.includes(this.protocol);
    },
    canLoad() {
      return Boolean(this.absoluteHref) && this.isBrowserProtocol && !this.requiresAuth;
    }
  }
};
</script>
