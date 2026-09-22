<template>
  <div class="asset-viewer-frame" :class="{ 'asset-viewer-fullscreen': fullscreen }">
    <h5 v-if="showTitle && !fullscreen" class="asset-viewer-title">
      <img
        v-if="isImageIcon"
        :src="viewer.icon"
        alt=""
        class="asset-viewer-icon img-fluid"
      >
      <span v-else class="asset-viewer-icon">{{ viewer.icon }}</span>
      {{ viewer.title }}
    </h5>
    <iframe
      v-if="src"
      class="asset-viewer-iframe"
      :src="src"
      :title="viewer.title"
      :style="!fullscreen ? { height: `${height}px` } : null"
      :allowfullscreen="viewer.allowFullscreen"
      :allow="allowFeatures"
      :sandbox="viewer.sandbox || undefined"
    />
    <b-button
      v-if="fullscreen"
      variant="primary"
      class="asset-viewer-fullscreen-exit"
      :title="$t('fullscreen.exit')"
      @click="toggleFullscreen(false)"
    >
      <b-icon-fullscreen-exit />
    </b-button>
  </div>
</template>

<script>
import { mapGetters } from 'vuex';
import {
  buildViewerUrl,
  isImageIcon,
  viewerHeight
} from './assetViewers.js';

export default {
  name: 'AssetViewerFrame',
  props: {
    viewer: {
      type: Object,
      required: true
    },
    asset: {
      type: Object,
      required: true
    },
    showTitle: {
      type: Boolean,
      default: true
    },
    fullscreen: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:fullscreen'],
  computed: {
    ...mapGetters(['getRequestUrl']),
    src() {
      if (!this.viewer.url || typeof this.asset.href !== 'string') {
        return null;
      }
      return buildViewerUrl(this.viewer, this.asset, this.getRequestUrl);
    },
    height() {
      return viewerHeight(this.viewer);
    },
    isImageIcon() {
      return isImageIcon(this.viewer.icon);
    },
    allowFeatures() {
      return this.viewer.allowFullscreen ? 'fullscreen' : undefined;
    }
  },
  methods: {
    toggleFullscreen(value) {
      this.$emit('update:fullscreen', value);
    }
  }
};
</script>

<style lang="scss">
#stac-browser .asset-viewer-frame {
  .asset-viewer-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 1rem;
    margin: 0 0 0.5rem;

    .asset-viewer-icon {
      width: 1.25rem;
      height: 1.25rem;
      line-height: 1.25rem;
      text-align: center;
      display: inline-block;
      flex: 0 0 auto;
    }
  }

  .asset-viewer-iframe {
    width: 100%;
    border: 1px solid var(--bs-border-color);
    border-radius: 0.25rem;
    display: block;
    background: #fff;
  }

  // "Full-tab" mode: take over the whole viewport without reloading the
  // iframe (the same element is just reflowed into a fixed overlay).
  &.asset-viewer-fullscreen {
    position: fixed;
    inset: 0;
    z-index: 1100;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.5rem;
    padding-right: 3.5rem; // room for the floating exit button
    background: var(--bs-body-bg, #fff);

    .asset-viewer-title {
      flex: 0 0 auto;
      margin: 0;
    }

    .asset-viewer-iframe {
      flex: 1 1 auto;
      height: auto !important;
    }

    .asset-viewer-fullscreen-exit {
      position: absolute;
      top: 0.5rem;
      right: 0.5rem;
      line-height: 1;
    }
  }
}
</style>