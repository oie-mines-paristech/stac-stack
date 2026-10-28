<template>
  <span class="clamped-text">
    <span class="clamped-text-value">{{ shown }}</span>
    <button
      v-if="clamped"
      type="button"
      class="clamped-text-toggle"
      :title="expanded ? $t('read.less') : $t('read.more')"
      :aria-label="expanded ? $t('read.less') : $t('read.more')"
      :aria-expanded="expanded ? 'true' : 'false'"
      @click="expanded = !expanded"
    >
      <b-icon-chevron-down v-if="expanded" />
      <b-icon-chevron-right v-else />
      {{ expanded ? $t('read.less') : $t('read.more') }}
    </button>
  </span>
</template>

<script>
export default {
  name: 'ClampedText',
  props: {
    text: {
      type: String,
      default: ''
    },
    limit: {
      type: Number,
      default: 150
    }
  },
  data() {
    return {
      expanded: false
    };
  },
  computed: {
    clamped() {
      return this.text.length > this.limit;
    },
    shown() {
      if (!this.clamped || this.expanded) {
        return this.text;
      }
      return this.text.slice(0, this.limit) + '…';
    }
  }
};
</script>

<style lang="scss">
#stac-browser .clamped-text-value {
  white-space: pre-line;
}
#stac-browser .clamped-text-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.2em;
  margin-left: 0.35em;
  padding: 0 0.5em;
  font-size: 0.8em;
  line-height: 1.6;
  border: 1px solid var(--bs-border-color);
  border-radius: 0.25rem;
  background: var(--bs-tertiary-bg);
  color: var(--bs-body-color);
  cursor: pointer;
}
#stac-browser .clamped-text-toggle:hover {
  background: var(--bs-secondary-bg);
  border-color: var(--bs-secondary);
}
</style>
