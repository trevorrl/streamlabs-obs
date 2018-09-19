<template>
<div class="input-container" :class="{ disabled }">
  <div class="input-label">
    <label v-if="showDescription !== false">{{ description }}</label>
  </div>
  <div class="input-wrapper">
    <div v-for="index in size" :key="index" class="checkbox">
      <input
        type="checkbox"
        :checked="value & (1 << (index - 1))"
        :disabled="disabled"
        @change="(event) => onChange(event, index)"
      />
      <label>{{ index }}</label>
    </div>
  </div>
</div>
</template>

<script lang="ts" src="./SettingsBitMaskInput.vue.ts"></script>

<style lang="less" scoped>

  .input-wrapper {
    width: auto;
  }

  .checkbox {
    width: auto;
    margin-right: 15px;
  }
</style>
