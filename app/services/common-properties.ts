import {
  IProperties,
  IProperty,
  ISettings,
  Source,
  EObjectType,
  EPropertyType,
  OutputFactory,
  ServiceFactory,
  Encoder,
  ETextType
} from 'services/obs-api';
import * as _ from 'lodash';
import {
  isListProperty,
  isEditableListProperty,
  isNumberProperty,
  isTextProperty,
  isFontProperty,
  isPathProperty
} from 'util/properties-type-guards';
import {
  TFormData,
  IFormInput,
  TObsValue
} from 'components/shared/forms/Input';
import { propertyComponentForType } from 'components/shared/forms/Components';
import Vue from 'vue';

export function parsePathFilters(filterStr: string) {
  const filters = _.compact(filterStr.split(';;'));

  // Browser source uses *.*
  if (filterStr === '*.*') {
    return [
      {
        name: 'All Files',
        extensions: ['*']
      }
    ];
  }

  return filters.map(filter => {
    const match = filter.match(/^(.*)\((.*)\)$/);
    const desc = _.trim(match[1]);
    let types = match[2].split(' ');

    types = types.map(type => {
      return type.match(/^\*\.(.+)$/)[1];
    });

    // This is the format that electron file dialogs use
    return {
      name: desc,
      extensions: types
    };
  });
}

interface ComponentList {
  component: typeof Vue;
  visible: boolean;
  properties: any;
}

export class BetterPropertiesManager {
  public settings: ISettings;

  constructor(
    public properties: IProperties,
    settings: ISettings | string,
    type?: EObjectType
  ) {
    if (typeof settings === 'string') {
      if (type == null) {
        throw TypeError('Type argument expected if string is passed');
      }

      switch (type) {
        case EObjectType.Output:
          this.settings = OutputFactory.getDefaults(settings);
          return;
        case EObjectType.Encoder:
          this.settings = Encoder.getDefaults(settings);
        case EObjectType.Service:
          this.settings = ServiceFactory.getDefaults(settings);
        case EObjectType.Source:
          this.settings = Source.getDefaults(settings);
      }
    } else {
      this.properties.apply(settings);
      this.settings = settings;
    }
  }

  createGenericFormData(): TFormData {
    const formData: TFormData = [];
    let obsProp = this.properties.first();
  }

  /* This is a little bit different than the 
   * generic form data. This
   * generates the components here and only
   * provides three things:
   * 1. The type of the component and
   * 2. some metadata on how the component should
   *    sit within the parent component (which 
   *    right now is just visibility).
   * 3. an object with the properties of the
   *    component. 
   * 
   * Technically, the properties can be reactive
   * if you hold the object and modify the values
   * on them accordingly, as compared to the v-model
   * method where it must be explicitly set. This
   * method also allows a better way of reusing 
   * those components outside of the generic forms */
  createComponentList(): ComponentList[] {
    const componentList = [];

    if (!this.properties) return null;

    let property = this.properties.first();

    do {
      const properties: any = {
        name: property.name,
        description: property.description,
        disabled: !property.enabled,
        visible: property.visible
      };

      const component: typeof Vue = propertyComponentForType(
        property.type,
        property['subType']
      );

      const visible = property.visible;

      if (isListProperty(property)) {
        const options = property.details.items.map(option => {
          return { value: option.value, description: option.name };
        });

        Object.assign(properties, { options });
      }

      if (isNumberProperty(property)) {
        Object.assign(properties, {
          min: property.details.min,
          max: property.details.max,
          step: property.details.step
        });
      }

      if (isEditableListProperty(property)) {
        Object.assign(properties, {
          filters: parsePathFilters(property.details.filter),
          defaultPath: property.details.defaultPath
        });
      }

      if (isPathProperty(property)) {
        Object.assign(properties, {
          filters: parsePathFilters(property.details.filter),
          defaultPath: property.details.defaultPath
        });
      }

      if (isTextProperty(property)) {
        Object.assign(properties, {
          multiline: property.details.type === ETextType.Multiline,
          masked: property.details.type === ETextType.Password
        });
      }

      componentList.push({ component, visible, properties });
    } while ((property = property.next()));

    return componentList;
  }

  /* When a property is modified, this needs to be called
   * If it returns true, createComponentList needs to be
   * called again and the UI refreshed. */
  modifyProperty(name: string, settings: ISettings): boolean {
    const property = this.properties.get(name);

    return property.modified(settings);
  }


}
