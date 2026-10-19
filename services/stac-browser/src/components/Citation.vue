<template>
  <section v-if="citation || doi" class="metadata citation mb-3">
    <b-row v-if="citation">
      <b-col md="4" class="label">{{ $t('citation') }}</b-col>
      <b-col md="8" class="value">
        <Description :description="linkedCitation" compact />
      </b-col>
    </b-row>
    <b-row v-if="doi">
      <b-col md="4" class="label">DOI</b-col>
      <b-col md="8" class="value">
        <a :href="doiUrl" target="_blank" rel="noopener noreferrer">{{ doi }}</a>
      </b-col>
    </b-row>
  </section>
</template>

<script>
import { defineComponent } from 'vue';
import Description from './Description.vue';

export default defineComponent({
  name: 'Citation',
  components: {
    Description
  },
  props: {
    citation: {
      type: String,
      default: ''
    },
    doi: {
      type: String,
      default: ''
    }
  },
  computed: {
    // Bare URLs are wrapped as CommonMark autolinks, so Description renders
    // them as <a> (its HTML renderer runs in safe mode, raw HTML stays escaped).
    linkedCitation() {
      return this.citation.replace(/https?:\/\/[^\s<>]+/g, url => {
        const trimmed = url.replace(/[.,;:!?)\]}]+$/, '');
        return `<${trimmed}>${url.slice(trimmed.length)}`;
      });
    },
    doiUrl() {
      const name = this.doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '');
      return `https://doi.org/${name}`;
    }
  }
});
</script>
