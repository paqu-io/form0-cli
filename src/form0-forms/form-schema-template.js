export const defaultFormTemplate = {
  form: {
    name: 'MyForm',
    description: 'This is a test description',
    id: null, //This should be the unique identifier of the form (UUIDv4 or UUIDv7 - TBD).
    record_count: 0, //This should count the number of records in the form. Available in reform.
    record_last_change_at: null, //This should be the date and time of the last record change in ISO 8601 format. Available in reform.
    form_created_at: null, //This should be the date and time of the form creation in ISO 8601 format. Available in reform.
    form_updated_at: null, //This should be the date and time of the form update in ISO 8601 format. Available in reform.
    form_created_by: null, //This should be the user who created the form. Available in reform. Available in reform.
    form_updated_by: null, //This should be the user who updated the form. Available in reform. Available in reform.
    status: 'active', //status can be active or inactive. Available in reform.
    version: 1, //This should be the version of the form and it's updated every time the form is saved. Available in reform.
    main_org_id: 'personal', //This should be the unique identifier of the main organization of the form (it can be 'personal' or one of the main organizations in the account). Available in reform.
    main_org_metadata: null, //This should be the metadata of the main organization of the form (it can be null or an array of fields to be included in each form). Available in reform.
    sub_org_id: null, //This should be the unique identifier of the sub-organization of the form (it can be null or one of the sub-organizations in the account). Available in reform.
    sub_org_metadata: null, //This should be the metadata of the sub-organization of the form (it can be null or an array of fields to be included in each form). Available in reform.
    project_id: null, //This should be the unique identifier of the project of the form (it can be null or one of the projects in the account). Available in reform.
    project_metadata: null, //This should be the metadata of the project of the form (it can be null or an array of fields to be included in each form). Available in reform.
    status_field: {
      type: 'StatusField',
      key: '@status',
      data_name: 'status',
      label: 'Status',
      display: 'default', //StatusField can only be 'default'
      enabled: true, //StatusField can be true or false
      visible: true,
      visible_conditions: null,
      read_only: false,
      read_only_conditions: null,
      default_value: 'pending',
      choices: [
        {
          label: 'Enrolled',
          value: 'enrolled',
          color: '#87D30F'
        },
        {
          label: 'Not Enrolled',
          value: 'not_enrolled',
          color: '#FF0000'
        },
        {
          label: 'Pending',
          value: 'pending',
          color: '#FFA500'
        },
      ],
    },
    title_field: {
      type: 'TitleField',
      key: '@title',
      data_name: 'title',
      label: 'Title',
      display: 'default', //TitleField   can only be 'default'
      enabled: true, //TitleField can only be true
      visible: true, //TitleField can only be true
      visible_conditions: null,
      read_only: true, //TitleField is always read_only = true
      read_only_conditions: null,
      elements: [ //Elements can be an array of elements or a single element. Elements should be field keys but field data_name can be used as fallback. Elements, when rendered, will be concatenated with each other with a comma and displayed at the top of the record as a title.
        'first_name',
        'city' //If a key/data_name refers to a SingleChoiceField, MultiChoiceField or BooleanField, we should always show the choice label.
      ],
    },
    bounding_box: [
      0,
      0,
      0,
      0
    ], //Bounding box containing all the form's records. Format is [min_lat, min_long, max_lat, max_long]. Available in reform.
    location_enabled: true, //location_enabled can be true or false
    location_required: true, //location_required can be true or false
    image: null, //The URL to the original image which was uploaded as this app's icon. Available in reform.
    image_thumbnail: null, //The URL to the thumbnail-sized image which was uploaded as this app's icon. 160x160 px. Available in reform.
    image_small: null, //The URL to the small-sized image which was uploaded as this app's icon. 320x320 px. Available in reform.
    image_large: null, //The URL to the medium-sized image which was uploaded as this app's icon. 640x640 px. Available in reform.
    events: {
      code: `
        function alertTest(event) {
          ALERT('Warning!', 'Welcome to South America!');
          ALERT('Warning!', 'Welcome to Colombia!');
          ALERT($email);
        }

        ON('load-record', alertTest);

        ON('change', 'city', function (event) {
          ALERT('Warning!', 'City changed to ' + CHOICEVALUE($city));
          SETVALUE('who_voted', 'Hoooooola!');
          SETVALUE('age', 33);
          SETVALUE('fruit', 'banana');
          SETVALUE('food', ['pasta', 'focaccia']);
        });

        ON('change', 'age', function (event) {
          ALERT('Warning!', 'Email changed to ' + $email);
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
            is_searchable: true,
            is_searchable_mode: 'default',
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
            is_searchable: false,
            is_searchable_mode: null,
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
            { field_id: 'can_vote', operator: 'equal_to', value: 'yes' },
            {
              or: [
                { field_id: 'age', operator: 'greater_than', value: 20 },
                { field_id: 'first_name', operator: 'equal_to', value: 'Bob' },
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
        is_searchable: false,
        is_searchable_mode: null,
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
        is_searchable: false,
        is_searchable_mode: null,
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
        location_enabled: true, //location_enabled can be true or false
        location_required: true, //location_required can be true or false
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
          {
            type: 'CalculatedField',
            data_name: 'age_division',
            label: 'Age divided by 2',
            display: {
              style: 'numeric', // or numeric, date, currency
            },
            description: null, //description can be null or a string
            description_mode: null, //description_mode can be null, 'default' or 'subtext'
            required: false, //CalcualtedField is always required = false
            visible: true,
            visible_conditions: null,
            read_only: true, //CalcualtedField is always read_only = true
            calculate: '$age/2',
            supporting_image: false, //supporting_image can be true or false
            supporting_image_path: null, //supporting_image_path can be null or a string
            supporting_image_display: null, //supporting_image_display can be 'default', 'dialog' or null
          },
          {
            type: "Section",
            data_name: "non_structural_assessment",
            label: "Non-structural assessment",
            display: "inline",
            description: "This is a test34",
            description_mode: "default",
            visible: true,
            visible_conditions: null,
            elements: [
              {
                type: "RepeatableSection",
                data_name: "water_sanitation",
                label: "Water & Sanitation",
                display: "drilldown",
                description: "This is a NESTED repeatable section for evaluation tests",
                description_mode: "default",
                visible: true,
                visible_conditions: null,
                location_enabled: true, //location_enabled can be true or false
                location_required: true, //location_required can be true or false
                elements: [
                  {
                    type: "Section",
                    data_name: "first_phase",
                    label: "First phase",
                    display: "inline",
                    description: "This is a test88",
                    description_mode: "default",
                    visible: true,
                    visible_conditions: null,
                    elements: [
                      {
                        type: "TextField",
                        data_name: "email_test_bis",
                        label: "Email Bis",
                        display: "default",
                        description: null,
                        description_mode: null,
                        required: true,
                        required_conditions: null,
                        visible: true,
                        visible_conditions: null,
                        read_only: false,
                        read_only_conditions: null,
                        default_value: "stefano@form0.dev",
                        pattern: "^[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}$",
                        pattern_description: "Valid email address format (e.g., user@example.com)",
                        supporting_image: false,
                        supporting_image_path: null,
                        supporting_image_display: null,
                      },
                      {
                        type: 'NumericField',
                        data_name: 'random_number',
                        label: 'Random number',
                        display: 'default', //NumericField can only be 'default'
                        description: null, //description can be null or a string
                        description_mode: null, //description_mode can be null, 'default' or 'subtext'
                        required: true,
                        required_conditions: null,
                        visible: true,
                        visible_conditions: null,
                        read_only: false,
                        read_only_conditions: null,
                        default_value: 10.84,
                        min: null,
                        max: null,
                        format: 'float', //NumericField can be 'integer' or 'float'
                        supporting_image: false, //supporting_image can be true or false
                        supporting_image_path: null, //supporting_image_path can be null or a string
                        supporting_image_display: null, //supporting_image_display can be 'default', 'dialog' or null
                      },
                    ],
                  }
                ],
              },    
            ],
          },
        ],
      },
    ],
  },
};
