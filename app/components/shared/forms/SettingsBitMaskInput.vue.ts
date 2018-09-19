import { Component, Prop, Watch } from 'vue-property-decorator';
import { Input, IFormInput, IBitmaskInput } from './Input';
import Vue from 'vue';

@Component
class SettingsBitMaskInput extends Vue {
  @Prop() value: number;

  @Prop({ default: true })
  showDescription: boolean;

  @Prop() description: string;

  @Prop({ default: false })
  disabled: boolean;

  @Prop({
    validator: (value: number) => {
      return value > 0 || value < 32;
    }
  })
  size: number;

  onChange(event: Event, index: number) {
    const element = event.target as HTMLInputElement;

    this.$emit('input', element.checked, index - 1);
  }
}

export default SettingsBitMaskInput;
