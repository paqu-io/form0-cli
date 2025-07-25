export const defaultFormTemplate = {
  form: {
    name: 'MyForm',
    description: 'This is a test description',
    record_count: 0,
    last_record_created_at: null,
    last_record_updated_at: null,
    last_record_deleted_by: null,
    status: 'active', //status can be active or inactive
    version: 1,
    events: {
      code: `
        function alertTest(event) {
          ALERT('Warning!', 'Welcome to South America!');
          ALERT('Warning!', 'Welcome to Colombia!');
        }

        ON('load-record', alertTest);

        ON('change', 'city', function (event) {
          ALERT('Warning!', 'City changed to ' + CHOICEVALUE($city));
          SETVALUE('who_voted', 'Hoooooola!');
          SETVALUE('age', 33);
          SETVALUE('fruit', 'banana');
          SETVALUE('food', ['pasta', 'focaccia']);
        });

        function colorsF(event) {
          const test = 'voted';
          const test2 = 'new';
          SETVALUE(EVAL('who_' + test), 'Tutti i colori!');
          ALERT('Warning!', 'This is an alert: ' + EVAL('$calc_test_' + test2));
        }

        ON('change', 'colors', colorsF);
      `
    },
    elements: [
      {
        type: 'Section',
        key: 'abcd1',
        data_name: 'personal_info',
        label: 'Personal Info',
        display: 'inline', //Section can be 'inline' or 'drilldown'
        description: 'This is a test description', //description can be null or a string
        description_mode: 'default', //description_mode can be null,'default' or 'subtext'
        visible: true,
        visible_conditions: null,
        elements: [
          {
            type: 'TextField',
            key: 'ef661',
            data_name: 'first_name',
            label: 'First Name',
            display: 'default', //TextField can only be 'default'
            description: 'This is a test description', //description can be null or a string
            description_mode: 'subtext', //description_mode can be null, 'default' or 'subtext'
            required: true,
            required_conditions: null,
            visible: true,
            visible_conditions: null,
            read_only: false,
            read_only_conditions: null,
            default_value: null,
            pattern: '^[a-zA-Z]+$',
            pattern_description:
              'One or more letters (uppercase or lowercase), with no spaces, numbers, or symbols',
            supporting_image: true, //supporting_image can be true or false
            supporting_image_path: 'first_name.jpg', //supporting_image_path can be null or a string
            supporting_image_display: 'default', //supporting_image_display can be 'default', 'dialog' or null
          },
          {
            type: 'SingleChoiceField',
            key: '0180f',
            data_name: 'city',
            label: 'City',
            display: 'default', //SingleChoiceField can be 'default' or 'radio'
            description: null, //description can be null or a string
            description_mode: null, //description_mode can be null, 'default' or 'subtext'
            required: true,
            required_conditions: null,
            visible: true,
            visible_conditions: null,
            read_only: false,
            read_only_conditions: null,
            default_value: null,
            allow_other: true, //SingleChoiceField can be true or false
            supporting_image: false, //supporting_image can be true or false
            supporting_image_path: null, //supporting_image_path can be null or a string
            supporting_image_display: null, //supporting_image_display can be 'default', 'dialog' or null
            choices: [
              {
                label: 'Bogotá',
                value: 'bogota',
              },
              {
                label: 'Recanati',
                value: 'recanati',
              },
              {
                label: 'New York',
                value: 'new_york',
              },
              {
                label: 'São Paulo - Centro',
                value: 'sao_paulo_centro',
              },
            ],
          },
          {
            type: 'MultiChoiceField',
            key: '0332f',
            data_name: 'colors',
            label: 'Please select your favorite colors',
            display: 'default', //MultiChoiceField can be 'default' or 'checkbox'
            description: null, //description can be null or a string
            description_mode: null, //description_mode can be null, 'default' or 'subtext'
            required: true,
            required_conditions: null,
            visible: true,
            visible_conditions: null,
            read_only: false,
            read_only_conditions: null,
            default_value: null,
            allow_other: true, //MultiChoiceField can be true or false
            supporting_image: false, //supporting_image can be true or false
            supporting_image_path: null, //supporting_image_path can be null or a string
            supporting_image_display: null, //supporting_image_display can be 'default', 'dialog' or null
            choices: [
              {
                label: 'Red',
                value: 'red',
              },
              {
                label: 'Blue',
                value: 'blue',
              },
              {
                label: 'Orange',
                value: 'orange',
              },
              {
                label: 'Yellow',
                value: 'yellow',
              },
            ],
          },
          {
            type: 'CalculatedField',
            key: 'ea322',
            data_name: 'city_calc',
            label: 'city_calc',
            display: {
              style: 'text', // or numeric, date, currency
            },
            description: null, //description can be null or a string
            description_mode: null, //description_mode can be null, 'default' or 'subtext'
            required: false, //CalcualtedField is always required = false
            visible: true,
            visible_conditions: null,
            read_only: true, //CalcualtedField is always read_only = true
            calculate: `
            const citySelection = CHOICEVALUE($city);
            SETRESULT(IF(OR(citySelection === "bogota", OTHER($city) === "Bogotá"), "Welcome to Bogotá!", "Welcome!"));
            `,
            supporting_image: false, //supporting_image can be true or false
            supporting_image_path: null, //supporting_image_path can be null or a string
            supporting_image_display: null, //supporting_image_display can be 'default', 'dialog' or null
          },
          {
            type: 'CalculatedField',
            key: 'aa123',
            data_name: 'colors_calc',
            label: 'colors_calc',
            display: {
              style: 'text', // or numeric, date, currency
            },
            description: null, //description can be null or a string
            description_mode: null, //description_mode can be null, 'default' or 'subtext'
            required: false, //CalcualtedField is always required = false
            visible: true,
            visible_conditions: null,
            read_only: true, //CalcualtedField is always read_only = true
            calculate: 'CHOICELABELS($colors) + " -> Other: " + OTHER($colors)',
            supporting_image: false, //supporting_image can be true or false
            supporting_image_path: null, //supporting_image_path can be null or a string
            supporting_image_display: null, //supporting_image_display can be 'default', 'dialog' or null
          },
          {
            type: 'NumericField',
            key: 'ccbb56',
            data_name: 'age',
            label: 'Age',
            display: 'default', //NumericField can only be 'default'
            description: null, //description can be null or a string
            description_mode: null, //description_mode can be null, 'default' or 'subtext'
            required: true,
            required_conditions: null,
            visible: true,
            visible_conditions: null,
            read_only: false,
            read_only_conditions: null,
            default_value: null,
            min: 16,
            max: 100,
            format: 'integer', //NumericField can be 'integer' or 'float'
            supporting_image: false, //supporting_image can be true or false
            supporting_image_path: null, //supporting_image_path can be null or a string
            supporting_image_display: null, //supporting_image_display can be 'default', 'dialog' or null
          },
        ],
      },
      {
        type: 'CalculatedField',
        key: 'ea3a1',
        data_name: 'can_vote',
        label: 'Eligible',
        display: {
          style: 'text', // or numeric, date, currency
        },
        description: null, //description can be null or a string
        description_mode: null, //description_mode can be null, 'default' or 'subtext'
        required: false, //CalcualtedField is always required = false
        visible: true,
        visible_conditions: null,
        read_only: true, //CalcualtedField is always read_only = true
        calculate: 'IF($age >= 18, "yes", "no")',
        supporting_image: false, //supporting_image can be true or false
        supporting_image_path: null, //supporting_image_path can be null or a string
        supporting_image_display: null, //supporting_image_display can be 'default', 'dialog' or null
      },
      {
        type: 'CalculatedField',
        key: 'e4567',
        data_name: 'calc_test',
        label: 'calc_test',
        display: {
          style: 'text', // or numeric, date, currency
        },
        description: null, //description can be null or a string
        description_mode: null, //description_mode can be null, 'default' or 'subtext'
        required: false, //CalcualtedField is always required = false
        visible: true,
        visible_conditions: null,
        read_only: true, //CalcualtedField is always read_only = true
        calculate: 'SETRESULT($age + 10 >= 30 ? true : false)',
        supporting_image: false, //supporting_image can be true or false
        supporting_image_path: null, //supporting_image_path can be null or a string
        supporting_image_display: null, //supporting_image_display can be 'default', 'dialog' or null
      },
      {
        type: 'CalculatedField',
        key: 'ee123',
        data_name: 'calc_test_new',
        label: 'calc_test_new',
        display: {
          style: 'text', // or numeric, date, currency
        },
        description: null, //description can be null or a string
        description_mode: null, //description_mode can be null, 'default' or 'subtext'
        required: false, //CalcualtedField is always required = false
        visible: true,
        visible_conditions: null,
        read_only: true, //CalcualtedField is always read_only = true
        calculate: '$age + 88',
        supporting_image: false, //supporting_image can be true or false
        supporting_image_path: null, //supporting_image_path can be null or a string
        supporting_image_display: null, //supporting_image_display can be 'default', 'dialog' or null
      },
      {
        type: 'DateField',
        key: 'ff551',
        data_name: 'field_visit_date',
        label: 'Field visit date',
        display: 'default', //DateField can only be 'default'
        description: null, //description can be null or a string
        description_mode: null, //description_mode can be null, 'default' or 'subtext'
        required: false,
        required_conditions: null,
        visible: true,
        visible_conditions: null,
        read_only: false,
        read_only_conditions: null,
        default_value: 'now', // can only be 'now' or null
      },
      {
        type: 'TimeField',
        key: 'a34a1',
        data_name: 'field_visit_time',
        label: 'Field visit time',
        display: 'default', //TimeField can only be 'default'
        description: null, //description can be null or a string
        description_mode: null, //description_mode can be null, 'default' or 'subtext'
        required: false,
        required_conditions: null,
        visible: true,
        visible_conditions: null,
        read_only: false,
        read_only_conditions: null,
        default_value: 'now', // can only be 'now' or null
      },
      {
        type: 'BooleanField',
        key: '1990f',
        data_name: 'gender',
        label: 'Gender',
        display: 'default', //BooleanField can only be 'default'
        description: null, //description can be null or a string
        description_mode: null, //description_mode can be null, 'default' or 'subtext'
        required: true,
        required_conditions: null,
        visible: true,
        visible_conditions: null,
        read_only: false,
        read_only_conditions: null,
        default_value: null,
        third_option_enabled: true, //BooleanField can be true or false
        supporting_image: false, //supporting_image can be true or false
        supporting_image_path: null, //supporting_image_path can be null or a string
        supporting_image_display: null, //supporting_image_display can be 'default', 'dialog' or null
        choices: [
          {
            label: 'Male',
            value: 'm',
          },
          {
            label: 'Female',
            value: 'f',
          },
          {
            label: 'Other',
            value: 'other',
          },
        ],
      },
      {
        type: 'LabelField',
        key: '1985ff',
        data_name: 'photo_consent',
        label: 'Please be aware that photographs may be taken at this Community Engagement event. By submitting this form, you consent to the use of any photos in which you appear in reports related to the Housing Improvement under PDUNM project and in Build Change marketing materials. You also acknowledge that the information you provide on this form will only be used for the purposes of this project.',
        display: 'default', //LabelField can only be 'default'
        description: null, //description can be null or a string
        description_mode: null, //description_mode can be null, 'default' or 'subtext'
        required: false, //LabelField is always required = false
        visible: true,
        visible_conditions: null,
        read_only: true, //LabelField is always read_only = true
        default_value: null, //LabelField is always default_value = null
        supporting_image: false, //supporting_image can be true or false
        supporting_image_path: null, //supporting_image_path can be null or a string
        supporting_image_display: null, //supporting_image_display can be 'default', 'dialog' or null
      },
      {
        type: 'CalculatedField',
        key: '1955ff',
        data_name: 'calc_test_new_bis',
        label: 'calc_test_new_bis',
        description: null, //description can be null or a string
        description_mode: null, //description_mode can be null, 'default' or 'subtext'
        required: false,
        visible: true,
        visible_conditions: null,
        read_only: true,
        calculate: '$calc_test_new + 1000',
        display: {
          style: 'text',
        },
        supporting_image: false, //supporting_image can be true or false
        supporting_image_path: null, //supporting_image_path can be null or a string
        supporting_image_display: null, //supporting_image_display can be 'default', 'dialog' or null
      },
      {
        type: 'SignatureField',
        key: '1993ff',
        data_name: 'signature',
        label: 'Please add your signature below',
        display: 'default', //SignatureField can only be 'default'
        description: null, //description can be null or a string
        description_mode: null, //description_mode can be null, 'default' or 'subtext'
        required: true,
        required_conditions: null,
        visible: true,
        visible_conditions: null,
        read_only: false,
        read_only_conditions: null,
        default_value: null, //SignatureField is always default_value = null
        agreement_text: 'I agree to the terms and conditions', //agreement_text can be null or a string
      },
      {
        type: 'PhotoField',
        key: '1991ff',
        data_name: 'house_photo',
        label: 'Take a photo of the house',
        display: 'default', //PhotoField can only be 'default'
        description: null, //description can be null or a string
        description_mode: null, //description_mode can be null, 'default' or 'subtext'
        required: false,
        required_conditions: null,
        visible: true,
        visible_conditions: null,
        read_only: false,
        read_only_conditions: null,
        default_value: null, //PhotoField is always default_value = null
        min_length: null, //min_length can be null or a number representing minimum number of photos
        max_length: null, //max_length can be null or a number representing maximum number of photos
      },
      {
        type: 'VideoField',
        key: '1989ff',
        data_name: 'house_video',
        label: 'Take a video of the house',
        display: 'default', //PhotoField can only be 'default'
        description: 'This is a description of the video field', //description can be null or a string
        description_mode: 'subtext', //description_mode can be null, 'default' or 'subtext'
        required: false,
        required_conditions: null,
        visible: true,
        visible_conditions: null,
        read_only: false,
        read_only_conditions: null,
        default_value: null, //PhotoField is always default_value = null
        min_length: null, //min_length can be null or a number representing minimum number of video minutes
        max_length: null, //max_length can be null or a number representing maximum number of video minutes
      },
      {
        type: 'Section',
        key: 'e4568',
        data_name: 'section_drill',
        label: 'Drilldown section test',
        display: 'drilldown', //Section can be 'inline' or 'drilldown'
        description: null, //description can be null or a string
        description_mode: null, //description_mode can be null, 'default' or 'subtext'
        visible: true,
        visible_conditions: null,
        elements: [
          {
            type: 'TextField',
            key: '43aa1',
            data_name: 'comments',
            label: 'Comments',
            display: 'default', //TextField can only be 'default'
            description: null, //description can be null or a string
            description_mode: null, //description_mode can be null, 'default' or 'subtext' 
            required: false,
            required_conditions: null,
            visible: true,
            visible_conditions: null,
            read_only: false,
            read_only_conditions: null,
            default_value: null,
            pattern: null,
            pattern_description: null,
            supporting_image: false, //supporting_image can be true or false
            supporting_image_path: null, //supporting_image_path can be null or a string
            supporting_image_display: null, //supporting_image_display can be 'default', 'dialog' or null
          },
        ],
      },
      {
        type: 'TextField',
        key: '11332',
        data_name: 'who_voted',
        label: 'Who voted?',
        display: 'default', //TextField can only be 'default'
        description: null, //description can be null or a string
        description_mode: null, //description_mode can be null, 'default' or 'subtext'
        required: true,
        required_conditions: null,
        visible: false,
        visible_conditions: {
          and: [
            { field_id: 'ea3a1', operator: 'equal_to', value: 'yes' },
            {
              or: [
                { field_id: 'ccbb56', operator: 'greater_than', value: 20 },
                { field_id: 'ef661', operator: 'equal_to', value: 'Bob' },
              ],
            },
          ],
        },
        read_only: true,
        read_only_conditions: null,
        default_value: null,
        pattern: null,
        pattern_description: null,
        supporting_image: false, //supporting_image can be true or false
        supporting_image_path: null, //supporting_image_path can be null or a string
        supporting_image_display: null, //supporting_image_display can be 'default', 'dialog' or null
      },
      {
        type: 'SingleChoiceField',
        key: '11487',
        data_name: 'fruit',
        label: 'Fruit',
        display: 'default',
        description: null, //description can be null or a string
        description_mode: null, //description_mode can be null, 'default' or 'subtext'
        required: true,
        required_conditions: null,
        visible: true,
        visible_conditions: null,
        read_only: false,
        read_only_conditions: null,
        default_value: null,
        allow_other: false,
        supporting_image: false, //supporting_image can be true or false
        supporting_image_path: null, //supporting_image_path can be null or a string
        supporting_image_display: null, //supporting_image_display can be 'default', 'dialog' or null
        choices: [
          {
            label: 'Mela',
            value: 'mela'
          },
          {
            label: 'Banana',
            value: 'banana'
          },
          {
            label: 'Fragola',
            value: 'fragola'
          }
        ],
      },
      {
        type: 'MultiChoiceField',
        key: '19998',
        data_name: 'food',
        label: 'Please select your favorite food!',
        display: 'default',
        description: null, //description can be null or a string
        description_mode: null, //description_mode can be null, 'default' or 'subtext'
        required: true,
        required_conditions: null,
        visible: true,
        visible_conditions: null,
        read_only: false,
        read_only_conditions: null,
        default_value: null,
        allow_other: false,
        supporting_image: false, //supporting_image can be true or false
        supporting_image_path: null, //supporting_image_path can be null or a string
        supporting_image_display: null, //supporting_image_display can be 'default', 'dialog' or null
        choices: [
          {
            label: 'Pasta',
            value: 'pasta'
          },
          {
            label: 'Pizza',
            value: 'pizza'
          },
          {
            label: 'Focaccia',
            value: 'focaccia'
          },
          {
            label: 'Salumi',
            value: 'salumi'
          }
        ],
      },
      {
        type: 'RepeatableSection',
        data_name: 'evaluation_tests',
        label: 'Evaluation tests',
        display: 'drilldown', //Section can be only 'drilldown'
        description: 'This is a repeatable section for evaluation tests', //description can be null or a string
        description_mode: 'default', //description_mode can be null,'default' or 'subtext'
        visible: true,
        visible_conditions: null,
        elements: [
          {
            type: 'TextField',
            data_name: 'email',
            label: 'Email',
            display: 'default', //TextField can only be 'default'
            description: null, //description can be null or a string
            description_mode: null, //description_mode can be null, 'default' or 'subtext'
            required: true,
            required_conditions: null,
            visible: true,
            visible_conditions: null,
            read_only: false,
            read_only_conditions: null,
            default_value: null,
            pattern: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$',
            pattern_description:
              'Valid email address format (e.g., user@example.com)',
            supporting_image: false, //supporting_image can be true or false
            supporting_image_path: null, //supporting_image_path can be null or a string
            supporting_image_display: null, //supporting_image_display can be 'default', 'dialog' or null
          },
        ],
      },
    ],
  },
};
