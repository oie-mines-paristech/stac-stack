<template>
  <PreviewShell :expanded="expanded" :height="height" @update:expanded="$emit('update:expanded', $event)">
    <template #default="{ contentKey }">
      <b-alert v-if="requiresAuth" show variant="warning" class="mb-0">
        {{ $t('authentication.required') }}
      </b-alert>
      <iframe
        v-else-if="canEmbed"
        :key="contentKey"
        class="html-preview-frame"
        :src="absoluteHref"
        sandbox="allow-scripts allow-same-origin allow-forms"
        title="HTML preview"
      />
    </template>
  </PreviewShell>
</template>

<script>
import { mapGetters } from 'vuex';
import { browserProtocols } from 'stac-js/src/http';
import PreviewShell from './PreviewShell.vue';
import { getPreviewHeight } from './previewAssets.js';

export default {
  name: 'HtmlPreviewPanel',
  components: {
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
    canEmbed() {
      return Boolean(this.absoluteHref) && this.isBrowserProtocol && !this.requiresAuth;
    }
  }
};
</script>

<style lang="scss">
#stac-browser {
  .html-preview-frame {
    width: 100%;
    height: 100%;
    border: 0;
    display: block;
  }
}
</style>
