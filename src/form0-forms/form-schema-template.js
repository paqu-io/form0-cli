export const defaultFormTemplate = {
  form: {
    name: 'MyFormWSL',
    description: 'This is a test description',
    id: null,
    form_created_at: null,
    form_updated_at: null,
    form_created_by: null,
    form_updated_by: null,
    status: 'active',
    version: '1',
    main_org_id: 'personal',
    main_org_metadata: null,
    sub_org_id: null,
    sub_org_metadata: null,
    project_id: null,
    project_metadata: null,
    ai: {
      context: [
        'safety_inspections',
        'incident_reporting'
      ],
      instructions: [
        'Keep data identifiers in English',
        'Avoid personal identifiers in suggestions'
      ],
      namingPolicy: {
        language: 'en',
        case: 'snake',
        asciiOnly: true,
        maxLength: 32
      },
      tasks: [
        'suggestFieldNames',
        'suggestFieldValues'
      ]
    },
    status_field: {
      type: 'StatusField',
      key: '@status',
      data_name: 'status',
      label: 'Status',
      display: 'default',
      enabled: true,
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
        }
      ]
    },
    title_field: {
      type: 'TitleField',
      key: '@title',
      data_name: 'title',
      label: 'Title',
      display: 'default',
      enabled: true,
      visible: true,
      visible_conditions: null,
      read_only: true,
      read_only_conditions: null,
      elements: [
        'first_name',
        'city'
      ]
    },
    bounding_box: [
      0,
      0,
      0,
      0
    ],
    location_enabled: true,
    location_required: true,
    image: null,
    image_thumbnail: null,
    image_small: null,
    image_large: null,
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
      `,
    },
    elements: [
      {
        type: 'Section',
        data_name: 'personal_info',
        label: 'Personal Info',
        display: 'inline',
        description: 'This is a test description',
        description_mode: 'default',
        visible: true,
        visible_conditions: null,
        elements: [
          {
            type: 'TextField',
            data_name: 'first_name',
            label: 'First Name',
            display: 'default',
            description: 'This is a test description',
            description_mode: 'subtext',
            required: true,
            required_conditions: null,
            visible: true,
            visible_conditions: null,
            read_only: false,
            read_only_conditions: null,
            default_value: null,
            pattern: '^[a-zA-Z]+$',
            pattern_description: 'One or more letters (uppercase or lowercase), with no spaces, numbers, or symbols',
            supporting_image: true,
            supporting_image_path: null,
            supporting_image_display: null,
            key: 'fbbf2ac1'
          },
          {
            type: 'SingleChoiceField',
            data_name: 'city',
            label: 'City',
            display: 'default',
            description: null,
            description_mode: null,
            required: true,
            required_conditions: null,
            visible: true,
            visible_conditions: null,
            read_only: false,
            read_only_conditions: null,
            default_value: null,
            allow_other: true,
            supporting_image: false,
            supporting_image_path: null,
            supporting_image_display: null,
            is_searchable: true,
            is_searchable_mode: 'default',
            choices: [
              {
                label: 'Bogotá',
                value: 'bogota'
              },
              {
                label: 'Recanati',
                value: 'recanati'
              },
              {
                label: 'New York',
                value: 'new_york'
              },
              {
                label: 'São Paulo - Centro',
                value: 'sao_paulo_centro'
              }
            ],
            key: 'dc48142'
          },
          {
            type: 'MultiChoiceField',
            data_name: 'colors',
            label: 'Please select your favorite colors',
            display: 'default',
            description: null,
            description_mode: null,
            required: true,
            required_conditions: null,
            visible: true,
            visible_conditions: null,
            read_only: false,
            read_only_conditions: null,
            default_value: null,
            allow_other: true,
            supporting_image: false,
            supporting_image_path: null,
            supporting_image_display: null,
            is_searchable: false,
            is_searchable_mode: null,
            choices: [
              {
                label: 'Red',
                value: 'red'
              },
              {
                label: 'Blue',
                value: 'blue'
              },
              {
                label: 'Orange',
                value: 'orange'
              },
              {
                label: 'Yellow',
                value: 'yellow'
              }
            ],
            key: 'f8f489b1'
          },
          {
            type: 'CalculatedField',
            data_name: 'city_calc',
            label: 'city_calc',
            display: {
              style: 'text'
            },
            description: null,
            description_mode: null,
            required: false,
            visible: true,
            visible_conditions: null,
            read_only: true,
            calculate: `
              const citySelection = CHOICEVALUE($city);
              SETRESULT(IF(OR(citySelection === "bogota", OTHER($city) === "Bogotá"), "Welcome to Bogotá!", "Welcome!"));
            `,
            supporting_image: false,
            supporting_image_path: null,
            supporting_image_display: null,
            key: '8cd7d66'
          },
          {
            type: 'CalculatedField',
            data_name: 'colors_calc',
            label: 'colors_calc',
            display: {
              style: 'text'
            },
            description: null,
            description_mode: null,
            required: false,
            visible: true,
            visible_conditions: null,
            read_only: true,
            calculate: 'CHOICELABELS($colors) + " -> Other: " + OTHER($colors)',
            supporting_image: false,
            supporting_image_path: null,
            supporting_image_display: null,
            key: 'b9ebebaf'
          },
          {
            type: 'NumericField',
            data_name: 'age',
            label: 'Age',
            display: 'default',
            description: null,
            description_mode: null,
            required: true,
            required_conditions: null,
            visible: true,
            visible_conditions: null,
            read_only: false,
            read_only_conditions: null,
            default_value: null,
            min: 16,
            max: 100,
            format: 'integer',
            supporting_image: false,
            supporting_image_path: null,
            supporting_image_display: null,
            key: '2c41499c'
          }
        ],
        key: '4c958746'
      },
      {
        type: 'CalculatedField',
        data_name: 'can_vote',
        label: 'Eligible',
        display: {
          style: 'text'
        },
        description: null,
        description_mode: null,
        required: false,
        visible: true,
        visible_conditions: null,
        read_only: true,
        calculate: 'IF($age >= 18, "yes", "no")',
        supporting_image: false,
        supporting_image_path: null,
        supporting_image_display: null,
        key: '7a2d9eb2'
      },
      {
        type: 'CalculatedField',
        data_name: 'calc_test',
        label: 'calc_test',
        display: {
          style: 'text'
        },
        description: null,
        description_mode: null,
        required: false,
        visible: true,
        visible_conditions: null,
        read_only: true,
        calculate: 'SETRESULT($age + 10 >= 30 ? true : false)',
        supporting_image: false,
        supporting_image_path: null,
        supporting_image_display: null,
        key: '78233e9'
      },
      {
        type: 'CalculatedField',
        data_name: 'calc_test_new',
        label: 'calc_test_new',
        display: {
          style: 'text'
        },
        description: null,
        description_mode: null,
        required: false,
        visible: true,
        visible_conditions: null,
        read_only: true,
        calculate: '$age + 88',
        supporting_image: false,
        supporting_image_path: null,
        supporting_image_display: null,
        key: '3914090c'
      },
      {
        type: 'DateField',
        data_name: 'field_visit_date',
        label: 'Field visit date',
        display: 'default',
        description: null,
        description_mode: null,
        required: false,
        required_conditions: null,
        visible: true,
        visible_conditions: null,
        read_only: false,
        read_only_conditions: null,
        default_value: 'now',
        key: 'b1628410'
      },
      {
        type: 'TimeField',
        data_name: 'field_visit_time',
        label: 'Field visit time',
        display: 'default',
        description: null,
        description_mode: null,
        required: false,
        required_conditions: null,
        visible: true,
        visible_conditions: null,
        read_only: false,
        read_only_conditions: null,
        default_value: 'now',
        key: 'b205e715'
      },
      {
        type: 'BooleanField',
        data_name: 'gender',
        label: 'Gender',
        display: 'default',
        description: null,
        description_mode: null,
        required: true,
        required_conditions: null,
        visible: true,
        visible_conditions: null,
        read_only: false,
        read_only_conditions: null,
        default_value: null,
        third_option_enabled: true,
        supporting_image: false,
        supporting_image_path: null,
        supporting_image_display: null,
        choices: [
          {
            label: 'Male',
            value: 'm'
          },
          {
            label: 'Female',
            value: 'f'
          },
          {
            label: 'Other',
            value: 'other'
          }
        ],
        key: '5e9c9580'
      },
      {
        type: 'LabelField',
        data_name: 'photo_consent',
        label: 'Please be aware that photographs may be taken at this Community Engagement event. By submitting this form, you consent to the use of any photos in which you appear in reports related to the Housing Improvement under PDUNM project and in Build Change marketing materials. You also acknowledge that the information you provide on this form will only be used for the purposes of this project.',
        display: 'default',
        description: null,
        description_mode: null,
        required: false,
        visible: true,
        visible_conditions: null,
        read_only: true,
        default_value: null,
        supporting_image: false,
        supporting_image_path: null,
        supporting_image_display: null,
        key: 'bb41535e'
      },
      {
        type: 'CalculatedField',
        data_name: 'calc_test_new_bis',
        label: 'calc_test_new_bis',
        description: null,
        description_mode: null,
        required: false,
        visible: true,
        visible_conditions: null,
        read_only: true,
        calculate: '$calc_test_new + 1000',
        display: {
          style: 'text'
        },
        supporting_image: false,
        supporting_image_path: null,
        supporting_image_display: null,
        key: '9b86a281'
      },
      {
        type: 'SignatureField',
        data_name: 'signature',
        label: 'Please add your signature below',
        display: 'default',
        description: null,
        description_mode: null,
        required: true,
        required_conditions: null,
        visible: true,
        visible_conditions: null,
        read_only: false,
        read_only_conditions: null,
        default_value: null,
        agreement_text: 'I agree to the terms and conditions',
        key: '5fab696d'
      },
      {
        type: 'PhotoField',
        data_name: 'house_photo',
        label: 'Take a photo of the house',
        display: 'default',
        description: null,
        description_mode: null,
        required: false,
        required_conditions: null,
        visible: true,
        visible_conditions: null,
        read_only: false,
        read_only_conditions: null,
        default_value: null,
        min_length: null,
        max_length: null,
        key: 'c8f98960'
      },
      {
        type: 'VideoField',
        data_name: 'house_video',
        label: 'Take a video of the house',
        display: 'default',
        description: 'This is a description of the video field',
        description_mode: 'subtext',
        required: false,
        required_conditions: null,
        visible: true,
        visible_conditions: null,
        read_only: false,
        read_only_conditions: null,
        default_value: null,
        min_length: null,
        max_length: null,
        key: 'c7a781d7'
      },
      {
        type: 'FormLinkField',
        key: '1f92ff',
        data_name: 'test_form_link',
        label: 'This is a form link test',
        display: 'default',
        description: null,
        description_mode: null,
        required: false,
        required_conditions: null,
        visible: true,
        visible_conditions: null,
        read_only: false,
        read_only_conditions: null,
        default_value: null,
        allow_creating_records: true,
        allow_existing_records: true,
        allow_updating_records: false,
        allow_multiple_records: false,
        form_id: '01936b8e-7f2a-7c3d-9e4f-123456789abc',
        record_conditions: {
          and: [
            {
              linked_form_field_id: 'sample123',
              operator: 'equal_to',
              value: 'test_value_1'
            },
            {
              or: [
                {
                  linked_form_field_id: 'sample456',
                  operator: 'greater_than',
                  value: 1.55
                },
                {
                  linked_form_field_id: 'sample789',
                  operator: 'equal_to',
                  value: 'test_value_3'
                }
              ]
            }
          ]
        },
        record_defaults: [
          {
            source_field_id: 'sample567',
            destination_field_id: 'ee748'
          },
          {
            source_field_id: 'sample234',
            destination_field_id: 'ee749'
          }
        ]
      },
      {
        type: 'TextField',
        key: 'ee748',
        data_name: 'first_import',
        label: 'First IMPORT',
        display: 'default',
        description: null,
        description_mode: null,
        required: false,
        required_conditions: null,
        visible: true,
        visible_conditions: null,
        read_only: true,
        read_only_conditions: null,
        default_value: null,
        pattern: null,
        pattern_description: null,
        supporting_image: false,
        supporting_image_path: null,
        supporting_image_display: null
      },
      {
        type: 'SingleChoiceField',
        key: 'ee749',
        data_name: 'second_import',
        label: 'Second IMPORT',
        display: 'default',
        description: null,
        description_mode: null,
        required: false,
        required_conditions: null,
        visible: true,
        visible_conditions: null,
        read_only: true,
        read_only_conditions: null,
        default_value: null,
        allow_other: false,
        supporting_image: false,
        supporting_image_path: null,
        supporting_image_display: null,
        is_searchable: false,
        is_searchable_mode: null,
        choices: [
          {
            label: 'Airplane',
            value: 'airplane'
          },
          {
            label: 'Car',
            value: 'car'
          }
        ]
      },
      {
        type: 'Section',
        data_name: 'section_drill',
        label: 'Drilldown section test',
        display: 'drilldown',
        description: null,
        description_mode: null,
        visible: true,
        visible_conditions: null,
        elements: [
          {
            type: 'TextField',
            data_name: 'comments',
            label: 'Comments',
            display: 'default',
            description: null,
            description_mode: null,
            required: false,
            required_conditions: null,
            visible: true,
            visible_conditions: null,
            read_only: false,
            read_only_conditions: null,
            default_value: null,
            pattern: null,
            pattern_description: null,
            supporting_image: false,
            supporting_image_path: null,
            supporting_image_display: null,
            key: '5886d2d7'
          }
        ],
        key: '153949b2'
      },
      {
        type: 'TextField',
        data_name: 'who_voted',
        label: 'Who voted?',
        display: 'default',
        description: null,
        description_mode: null,
        required: true,
        required_conditions: null,
        visible: false,
        visible_conditions: {
          and: [
            {
              field_id: '7a2d9eb2',
              operator: 'equal_to',
              value: 'yes'
            },
            {
              or: [
                {
                  field_id: '2c41499c',
                  operator: 'greater_than',
                  value: 20
                },
                {
                  field_id: 'fbbf2ac1',
                  operator: 'equal_to',
                  value: 'Bob'
                }
              ]
            }
          ]
        },
        read_only: true,
        read_only_conditions: null,
        default_value: null,
        pattern: null,
        pattern_description: null,
        supporting_image: false,
        supporting_image_path: null,
        supporting_image_display: null,
        key: '91e56640'
      },
      {
        type: 'SingleChoiceField',
        data_name: 'fruit',
        label: 'Fruit',
        display: 'default',
        description: null,
        description_mode: null,
        required: true,
        required_conditions: null,
        visible: true,
        visible_conditions: null,
        read_only: false,
        read_only_conditions: null,
        default_value: null,
        allow_other: false,
        supporting_image: false,
        supporting_image_path: null,
        supporting_image_display: null,
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
        key: 'd76a9191'
      },
      {
        type: 'BuildingPlanSection',
        key: 'd76a8181',
        data_name: 'building_plan',
        label: 'Building Plan',
        description: null,
        description_mode: null,
        visible: true,
        visible_conditions: null,
        read_only: false,
        read_only_conditions: null,
        node_overrides: {
          floors: {
            extra_elements: [
              {
                type: 'TextField',
                key: 'c96a8181',
                data_name: 'floor_reference',
                label: 'Floor Reference Code',
                display: 'default',
                description: null,
                description_mode: null,
                required: false,
                required_conditions: null,
                visible: true,
                visible_conditions: null,
                read_only: false,
                read_only_conditions: null,
                default_value: null,
                pattern: null,
                pattern_description: null,
                supporting_image: false,
                supporting_image_path: null,
                supporting_image_display: null
              }
            ]
          },
          columns: {
            extra_elements: [
              {
                type: 'SingleChoiceField',
                key: 'e96a8181',
                data_name: 'column_material',
                label: 'Column Material',
                display: 'default',
                description: null,
                description_mode: null,
                required: false,
                required_conditions: null,
                visible: true,
                visible_conditions: null,
                read_only: false,
                read_only_conditions: null,
                default_value: null,
                allow_other: true,
                supporting_image: false,
                supporting_image_path: null,
                supporting_image_display: null,
                is_searchable: false,
                is_searchable_mode: null,
                choices: [
                  {
                    label: 'Concrete',
                    value: 'concrete'
                  },
                  {
                    label: 'Steel',
                    value: 'steel'
                  },
                  {
                    label: 'Timber',
                    value: 'timber'
                  }
                ]
              }
            ]
          }
        }
      },
      {
        type: 'BuildingPlanSection',
        key: 'd76a8199',
        data_name: 'building_plan_bis',
        label: 'Building Plan Bis',
        description: null,
        description_mode: null,
        visible: true,
        visible_conditions: null,
        read_only: false,
        read_only_conditions: null,
        node_overrides: {
          floors: {
            extra_elements: [
              {
                type: 'TextField',
                key: 'c96a8199',
                data_name: 'floor_reference_bis',
                label: 'Floor Reference Code',
                display: 'default',
                description: null,
                description_mode: null,
                required: false,
                required_conditions: null,
                visible: true,
                visible_conditions: null,
                read_only: false,
                read_only_conditions: null,
                default_value: null,
                pattern: null,
                pattern_description: null,
                supporting_image: false,
                supporting_image_path: null,
                supporting_image_display: null
              }
            ]
          },
          columns: {
            extra_elements: [
              {
                type: 'SingleChoiceField',
                key: 'e96a8199',
                data_name: 'column_material_bis',
                label: 'Column Material',
                display: 'default',
                description: null,
                description_mode: null,
                required: false,
                required_conditions: null,
                visible: true,
                visible_conditions: null,
                read_only: false,
                read_only_conditions: null,
                default_value: null,
                allow_other: true,
                supporting_image: false,
                supporting_image_path: null,
                supporting_image_display: null,
                is_searchable: false,
                is_searchable_mode: null,
                choices: [
                  {
                    label: 'Concrete',
                    value: 'concrete'
                  },
                  {
                    label: 'Steel',
                    value: 'steel'
                  },
                  {
                    label: 'Timber',
                    value: 'timber'
                  }
                ]
              }
            ]
          }
        }
      },
      {
        type: 'MultiChoiceField',
        data_name: 'food',
        label: 'Please select your favorite food!',
        display: 'default',
        description: null,
        description_mode: null,
        required: true,
        required_conditions: null,
        visible: true,
        visible_conditions: null,
        read_only: false,
        read_only_conditions: null,
        default_value: null,
        allow_other: false,
        supporting_image: false,
        supporting_image_path: null,
        supporting_image_display: null,
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
        key: '3d5073c9'
      },
      {
        type: 'RepeatableSection',
        data_name: 'evaluation_tests',
        label: 'Evaluation tests',
        display: 'drilldown',
        description: 'This is a repeatable section for evaluation tests',
        description_mode: 'default',
        visible: true,
        visible_conditions: null,
        location_enabled: true,
        location_required: true,
        elements: [
          {
            type: 'TextField',
            data_name: 'email',
            label: 'Email',
            display: 'default',
            description: null,
            description_mode: null,
            required: true,
            required_conditions: null,
            visible: true,
            visible_conditions: null,
            read_only: false,
            read_only_conditions: null,
            default_value: null,
            pattern: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$',
            pattern_description: 'Valid email address format (e.g., user@example.com)',
            supporting_image: false,
            supporting_image_path: null,
            supporting_image_display: null,
            key: '8a8753c7'
          },
          {
            type: 'CalculatedField',
            data_name: 'age_division',
            label: 'Age divided by 2',
            display: {
              style: 'numeric'
            },
            description: null,
            description_mode: null,
            required: false,
            visible: true,
            visible_conditions: null,
            read_only: true,
            calculate: '$age/2',
            supporting_image: false,
            supporting_image_path: null,
            supporting_image_display: null,
            key: '6572e98a'
          },
          {
            type: 'NumericField',
            data_name: 'number',
            label: 'Number',
            display: 'default',
            description: null,
            description_mode: null,
            required: true,
            required_conditions: null,
            visible: true,
            visible_conditions: null,
            read_only: false,
            read_only_conditions: null,
            default_value: null,
            min: null,
            max: null,
            format: 'integer',
            supporting_image: false,
            supporting_image_path: null,
            supporting_image_display: null,
            key: '2c41499d'
          },
          {
            type: 'CalculatedField',
            data_name: 'age_multiplication_internal',
            label: 'Age multiplied by 8 and Number added',
            display: {
              style: 'numeric'
            },
            description: null,
            description_mode: null,
            required: false,
            visible: true,
            visible_conditions: null,
            read_only: true,
            calculate: '$age_division*8 + $number',
            supporting_image: false,
            supporting_image_path: null,
            supporting_image_display: null,
            key: '6572e98b'
          },
          {
            type: 'Section',
            data_name: 'non_structural_assessment',
            label: 'Non-structural assessment',
            display: 'inline',
            description: 'This is a test34',
            description_mode: 'default',
            visible: true,
            visible_conditions: null,
            elements: [
              {
                type: 'RepeatableSection',
                data_name: 'water_sanitation',
                label: 'Water & Sanitation',
                display: 'drilldown',
                description: 'This is a NESTED repeatable section for evaluation tests',
                description_mode: 'default',
                visible: true,
                visible_conditions: null,
                location_enabled: true,
                location_required: true,
                elements: [
                  {
                    type: 'Section',
                    data_name: 'first_phase',
                    label: 'First phase',
                    display: 'inline',
                    description: 'This is a test88',
                    description_mode: 'default',
                    visible: true,
                    visible_conditions: null,
                    elements: [
                      {
                        type: 'TextField',
                        data_name: 'email_test_bis',
                        label: 'Email Bis',
                        display: 'default',
                        description: null,
                        description_mode: null,
                        required: true,
                        required_conditions: null,
                        visible: true,
                        visible_conditions: null,
                        read_only: false,
                        read_only_conditions: null,
                        default_value: 'stefano@form0.dev',
                        pattern: '^[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}$',
                        pattern_description: 'Valid email address format (e.g., user@example.com)',
                        supporting_image: false,
                        supporting_image_path: null,
                        supporting_image_display: null,
                        key: 'f35360a1'
                      },
                      {
                        type: 'NumericField',
                        data_name: 'random_number',
                        label: 'Random number',
                        display: 'default',
                        description: null,
                        description_mode: null,
                        required: true,
                        required_conditions: null,
                        visible: true,
                        visible_conditions: null,
                        read_only: false,
                        read_only_conditions: null,
                        default_value: 10.84,
                        min: null,
                        max: null,
                        format: 'float',
                        supporting_image: false,
                        supporting_image_path: null,
                        supporting_image_display: null,
                        key: 'de7d5586'
                      },
                      {
                        type: 'NumericField',
                        data_name: 'number_bis',
                        label: 'Number',
                        display: 'default',
                        description: null,
                        description_mode: null,
                        required: true,
                        required_conditions: null,
                        visible: true,
                        visible_conditions: null,
                        read_only: false,
                        read_only_conditions: null,
                        default_value: null,
                        min: null,
                        max: null,
                        format: 'integer',
                        supporting_image: false,
                        supporting_image_path: null,
                        supporting_image_display: null,
                        key: '2c41499e'
                      },
                      {
                        type: 'CalculatedField',
                        data_name: 'calculus',
                        label: 'Calculus',
                        display: {
                          style: 'numeric'
                        },
                        description: null,
                        description_mode: null,
                        required: false,
                        visible: true,
                        visible_conditions: null,
                        read_only: true,
                        calculate: '$random_number + $number_bis',
                        supporting_image: false,
                        supporting_image_path: null,
                        supporting_image_display: null,
                        key: '6572e98e'
                      }
                    ],
                    key: 'adeb3b41'
                  }
                ],
                key: '43b53a75'
              }
            ],
            key: 'cc77ee19'
          }
        ],
        key: '9a4d5455'
      }
    ]
  }
};
