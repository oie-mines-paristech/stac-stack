<template>
  <div class="widget" v-for="widget of visibleWidgets" :key="widget.key">
    <component :is="widget.id" v-bind="widget.props" />
  </div>
</template>

<script>
import { defineAsyncComponent } from 'vue';
import widgetConfig from '../../widgets.config';

// OIE runtime override: orgs can (re)define widgets per slot via
// window.STAC_BROWSER_CONFIG.widgetConfigs (injected from SB_widgetConfigs),
// so the homepage content is set at container start, not at build time.
const browserConfig = (typeof window !== 'undefined' && window.STAC_BROWSER_CONFIG) || {};
const widgetConfig_ = browserConfig.widgetConfigs
  ? Object.assign({}, widgetConfig, browserConfig.widgetConfigs)
  : widgetConfig;

export default {
  name: 'WidgetHook',
  components: {},
  props: {
    id: {
      type: String,
      required: true,
    }
  },
  data() {
    return {
      widgets: [],
    };
  },
  computed: {
    visibleWidgets() {
      return this.widgets.filter(widget => {
        if (typeof widget.condition !== 'function') {
          return true;
        }
        try {
          const { state, getters } = this.$store;
          return Boolean(widget.condition({
            data: state.data,
            state,
            getters
          }));
        } catch (error) {
          console.error(`Condition for widget '${widget.id}' failed:`, error);
          return false;
        }
      });
    }
  },
  created() {
    const widgets = widgetConfig_[this.id];
    if (!Array.isArray(widgets)) {
      return;
    }
    widgets.forEach((widget, index) => {
      let component = widget.component;
      if (!component && !widget.id) {
        console.error(`A widget for the hook '${this.id}' defines neither an 'id' nor a 'component' and is not shown.`);
        return;
      }
      if (!component) {
        component = defineAsyncComponent(
          () => import(`../widgets/${widget.id}.vue`)
        );
      }
      const id = widget.id || `Widget${index}`;
      this.$options.components[id] = component;
      this.widgets.push({
        id,
        key: `${id}:${index}`,
        condition: widget.condition,
        props: widget.props || {},
      });
    });
  },
};
</script>
