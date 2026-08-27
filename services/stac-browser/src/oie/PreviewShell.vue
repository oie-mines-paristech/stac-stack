<template>
  <div class="asset-preview" :class="[variantClass, { expanded }]" :style="shellStyle">
    <div v-if="expanded" class="overlay-exit">
      <b-button variant="dark" @click="collapse" :title="$t('fullscreen.exit')">
        {{ $t('fullscreen.exitLabel') }}
      </b-button>
    </div>
    <slot :content-key="contentKey" />
  </div>
</template>

<script>
export default {
  name: 'PreviewShell',
  props: {
    expanded: {
      type: Boolean,
      default: false
    },
    height: {
      type: Number,
      default: 350
    },
    variant: {
      type: String,
      default: 'default',
      validator: value => ['default', 'notebook'].includes(value)
    }
  },
  data() {
    return {
      contentKey: 0
    };
  },
  computed: {
    variantClass() {
      return this.variant === 'notebook' ? 'notebook-preview' : 'html-preview';
    },
    shellStyle() {
      if (this.expanded) {
        return null;
      }
      return { height: `${this.height}px` };
    }
  },
  watch: {
    expanded(expanded, previous) {
      if (expanded === previous) {
        return;
      }
      document.body.style.overflow = expanded ? 'hidden' : '';
      this.$nextTick(() => {
        this.contentKey += 1;
        this.$emit('expanded-change', expanded);
      });
    }
  },
  beforeDestroy() {
    document.body.style.overflow = '';
  },
  methods: {
    collapse() {
      this.$emit('update:expanded', false);
    }
  }
};
</script>

<style lang="scss">
@import '../theme/variables.scss';

#stac-browser {
  .asset-preview {
    box-sizing: border-box;
    overflow: hidden;
    border: 1px solid $body-bg;
    border-radius: $border-radius;
    position: relative;

    .overlay-exit {
      text-align: right;
      position: sticky;
      top: 0;
      right: 0;
      left: 0;
      height: 0;
      width: 100%;
      z-index: 1;

      .btn {
        margin: 5px;
      }
    }

    &.expanded {
      position: fixed;
      inset: 0;
      z-index: 10000;
      width: 100vw;
      height: 100vh;
      border: 0;
      border-radius: 0;
      background-color: white;
    }

    &.notebook-preview {
      overflow: auto;

      &.expanded .notebook-preview-body {
        max-width: none;
      }
    }
  }
}
</style>
