<template>
  <b-table
    class="metadata-table" :items="tblItems" :fields="tblFields"
    :tbody-tr-class="rowClass"
    responsive small sticky-header striped
    bordered show-empty v-bind="tblTexts"
  >
    <template #head()="data">
      <span v-html="data.label" />
    </template>
    <template #cell()="data">
      <template v-if="isGroupRow(data.item)">
        <button
          v-if="data.field.key === nameFieldKey"
          type="button" class="group-toggle"
          :aria-expanded="isGroupOpen(data.item._group) ? 'true' : 'false'"
          @click="toggleGroup(data.item._group)"
        >
          <span class="group-chevron" aria-hidden="true">{{ isGroupOpen(data.item._group) ? '▾' : '▸' }}</span>
          {{ data.item._group }}
          <span class="group-count">({{ data.item._count }})</span>
        </button>
      </template>
      <span v-else-if="showsGroupedName(data)" class="var-name indented">{{ shortName(data.item) }}</span>
      <Histogram v-else-if="data.field.key === 'histogram' && isObject(data.unformatted)" :data="data.unformatted" />
      <ClampedText v-else-if="isClampedDescription(data)" :text="data.item.description" />
      <span v-else v-html="data.value" />
    </template>
  </b-table>
</template>

<script>
import EntryMixin from './EntryMixin';
import StacFieldsMixin from '../StacFieldsMixin';
import { isObject } from 'stac-js/src/utils.js';
import { format } from '@radiantearth/stac-fields';
import { defineAsyncComponent } from 'vue';
import { BTable } from 'bootstrap-vue-next';

// Variable-like tables: names may carry a one-level group path ("qc/observation_missing"),
// rendered as collapsed groups below the root variables.
const GROUPED_FIELDS = ['cube:variables', 'bands'];

export default {
  name: 'MetadataTable',
  components: {
    Histogram: defineAsyncComponent(() => import('./Histogram.vue')),
    ClampedText: defineAsyncComponent(() => import('./ClampedText.vue')),
    BTable
  },
  mixins: [
    EntryMixin,
    StacFieldsMixin({ format })
  ],
  data() {
    return {
      openGroups: []
    };
  },
  computed: {
    tblTexts() {
      return {
        'empty-filtered-text': this.$t('table.emptyFilteredText'),
        'empty-text': this.$t('table.emptyText'),
        'label-sort-asc': this.$t('table.sort.asc'),
        'label-sort-desc': this.$t('table.sort.desc'),
        'label-sort-clear': this.$t('table.sort.clear')
      };
    },
    rawItems() {
      if (isObject(this.value)) {
        let items = [];
        for(let key in this.value) {
          items.push({
            _id: key,
            ...this.value[key]
          });
        }
        return items;
      }
      else {
        return this.value;
      }
    },
    // The name column doubles as the group toggle holder: a row header for
    // keyed objects (cube:variables), the "name" field for lists (bands).
    nameFieldKey() {
      return isObject(this.value) ? '_id' : 'name';
    },
    grouping() {
      if (!Array.isArray(this.rawItems) || !GROUPED_FIELDS.includes(this.field)) {
        return false;
      }
      return this.rawItems.some(item => {
        const name = item[this.nameFieldKey];
        return typeof name === 'string' && name.includes('/');
      });
    },
    tblItems() {
      const items = this.rawItems;
      if (!this.grouping) {
        return items;
      }
      const root = [];
      const groups = new Map();
      for (const item of items) {
        const name = item[this.nameFieldKey];
        const slash = typeof name === 'string' ? name.indexOf('/') : -1;
        if (slash < 0) {
          root.push(item);
          continue;
        }
        const group = name.slice(0, slash);
        if (!groups.has(group)) {
          groups.set(group, []);
        }
        groups.get(group).push(item);
      }
      const sorted = [...groups.keys()].sort((a, b) => a.localeCompare(b));
      for (const group of sorted) {
        const groupItems = groups.get(group);
        root.push({
          [this.nameFieldKey]: `group:${group}`,
          _group: group,
          _count: groupItems.length,
          _grouped: true
        });
        if (this.isGroupOpen(group)) {
          root.push(...groupItems);
        }
      }
      return root;
    },
    tblFields() {
      let fields = [];
      for(let key of this.itemOrder) {
        let col = this.items[key];
        fields.push({
          key,
          label: col.label,
          sortable: this.grouping ? false : col.sortable,
          formatter: this.formatCell.bind(this),
          default: col.default
        });
      }
      if (isObject(this.value)) {
        fields.unshift({
          key: '_id',
          sortable: !this.grouping,
          isRowHeader: true
        });
      }
      return fields;
    }
  },
  methods: {
    isObject(value) {
      return isObject(value);
    },
    isGroupRow(item) {
      return Boolean(item && item._grouped);
    },
    isGroupOpen(group) {
      return this.openGroups.includes(group);
    },
    toggleGroup(group) {
      this.openGroups = this.isGroupOpen(group)
        ? this.openGroups.filter(name => name !== group)
        : [...this.openGroups, group];
    },
    // Grouped variables drop the "group/" prefix: the group header already
    // shows it. Only the display changes, the name keeps its full path.
    showsGroupedName(data) {
      return this.grouping && data.field.key === this.nameFieldKey;
    },
    shortName(item) {
      const name = item[this.nameFieldKey];
      const slash = typeof name === 'string' ? name.indexOf('/') : -1;
      return slash < 0 ? name : name.slice(slash + 1);
    },
    isClampedDescription(data) {
      return GROUPED_FIELDS.includes(this.field)
        && data.field.key === 'description'
        && typeof data.item?.description === 'string';
    },
    rowClass(item) {
      return this.isGroupRow(item) ? 'metadata-group-row' : '';
    },
    formatCell(value, key, item) {
      let spec = this.items[key];
      // ToDo: Set context (third param)?
      if (typeof spec.default !== 'undefined' && (typeof value === 'undefined' || value === null)) {
        value = spec.default;
      }
      return this.format(value, key, null, item, spec);
    }
  }
};
</script>

<style>
#stac-browser .metadata-table .table thead th {
  vertical-align: middle;
}
#stac-browser .metadata-table .group-toggle {
  border: 0;
  background: none;
  padding: 0;
  font-weight: 600;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
#stac-browser .metadata-table .group-toggle:hover {
  color: var(--bs-link-color);
}
#stac-browser .metadata-table .group-chevron {
  display: inline-block;
  width: 1em;
}
#stac-browser .metadata-table .var-name.indented {
  padding-left: 1.25em;
}
#stac-browser .metadata-table .group-count {
  color: var(--bs-secondary-color);
  font-weight: 400;
}
#stac-browser .metadata-table tr.metadata-group-row > * {
  background: var(--bs-tertiary-bg);
}
</style>
