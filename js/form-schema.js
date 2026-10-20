/* Esquema del formulario, traducido del XLSForm "App Instalaciones general" (Survey123).
 * name  = nombre del campo en la capa (igual que en el XLSForm).
 * Las preguntas de tipo image no son campos: se envían como adjuntos con keyword = name.
 * Las listas de opciones se sustituyen por el dominio de la capa si el campo lo tiene.
 */
self.FORM = {
  title: 'Instalaciones RUTE',

  lists: {
    list_nloc: [{ name: '1', label: 'RUTE' }],
    list_instal: [
      { name: 'Captacion', label: 'Captación' },
      { name: 'Deposito', label: 'Depósito' },
      { name: 'Arqueta', label: 'Arquetas' },
      { name: 'ArquetImpuls', label: 'Arq. Impulsión' }
    ],
    list_tipo_contador: [
      { name: 'Woltman', label: 'Woltman' },
      { name: 'Ultrasónico', label: 'Ultrasónico' },
      { name: 'Electromagnético', label: 'Electromagnético' }
    ],
    list_tipo_Snivel: [
      { name: 'Sonda de Radar', label: 'Sonda de radar' },
      { name: 'Sonda hidrostática', label: 'Sonda hidrostática' }
    ],
    list_model_RTU: [
      { name: 'M102', label: 'M102' },
      { name: 'M103', label: 'M103' },
      { name: 'M130', label: 'M130' },
      { name: 'M140', label: 'M140' },
      { name: 'Lp', label: 'LP+' },
      { name: 'Nemo', label: 'Nemo' }
    ],
    list_GTW: [{ name: 'Multitech', label: 'Multitech' }]
  },

  sections: [
    {
      id: 'ident', title: 'Identificación', short: 'Datos', icon: 'i-pin', always: true,
      fields: [
        { name: 'ID_instalador', label: 'ID instalador', type: 'text', required: true, uppercase: true, remember: true,
          hint: 'Iniciales del técnico en mayúsculas. Ponlas siempre igual.' },
        { name: 'NLOC', label: 'Población', type: 'select_one', list: 'list_nloc', required: true },
        { name: 'instal', label: 'Tipo de instalación', type: 'select_one', list: 'list_instal', required: true },
        { name: 'Nombre_Inst', label: 'Nombre de la instalación', type: 'text' },
        { name: '_location', label: 'Ubicación de la instalación', type: 'geopoint', required: true,
          hint: 'Si el GPS no da precisión suficiente, mueve el mapa para colocar el punto a mano.' },
        { name: 'Inciden1', label: 'Incidencias', type: 'textarea' },
        { name: 'Foto_Incidencia', label: 'Fotografía de la incidencia', type: 'image' }
      ]
    },
    {
      id: 'rtu', title: 'Cuadros RTU', short: 'RTU', icon: 'i-rtu',
      hint: 'Características de las RTU instaladas.',
      fields: [
        { name: 'ID_Cuadro', label: 'ID del cuadro', type: 'text' },
        { name: 'Model1', label: 'Modelo RTU', type: 'select_multiple', list: 'list_model_RTU', hint: 'Puedes marcar varios.' },
        { name: 'Date1', label: 'Inicio de instalación', type: 'dateTime' },
        { name: 'Foto_Ini_RTU', label: 'Foto estado previo', type: 'image' },
        { name: 'Foto_fin_RTU', label: 'Foto del cuadro tras la instalación', type: 'image' },
        { name: 'Foto_Detall_RTU', label: 'Foto de detalle del cuadro', type: 'image', hint: 'Cuadro abierto, con el interior de la puerta.' },
        { name: 'EndDate1', label: 'Fin de instalación', type: 'dateTime' },
        { name: 'Observ1', label: 'Observaciones', type: 'textarea' }
      ]
    },
    {
      id: 'snivel', title: 'Sonda de nivel', short: 'Nivel', icon: 'i-level',
      fields: [
        { name: 'tipo_Snivel', label: 'Tipo de sonda', type: 'select_one', list: 'list_tipo_Snivel' },
        { name: 'Num_serie2', label: 'Número de serie', type: 'barcode' },
        { name: 'Fab2', label: 'Fabricante', type: 'text' },
        { name: 'Model2', label: 'Modelo', type: 'text' },
        { name: 'Date2', label: 'Inicio de instalación', type: 'dateTime' },
        { name: 'Foto_Ini_SNIVEL', label: 'Foto estado previo', type: 'image' },
        { name: 'Foto_fin_SNIVEL', label: 'Foto tras la instalación', type: 'image' },
        { name: 'EndDate2', label: 'Fin de instalación', type: 'dateTime' },
        { name: 'Observ2', label: 'Observaciones', type: 'textarea' }
      ]
    },
    {
      id: 'spresion', title: 'Sonda de presión', short: 'Presión', icon: 'i-gauge',
      fields: [
        { name: 'Num_serie3', label: 'Número de serie', type: 'barcode' },
        { name: 'Fab3', label: 'Fabricante', type: 'text' },
        { name: 'Model3', label: 'Modelo', type: 'text' },
        { name: 'Date3', label: 'Inicio de instalación', type: 'dateTime' },
        { name: 'Foto_Ini_SPRESION', label: 'Foto estado previo', type: 'image' },
        { name: 'Foto_fin_SPRESION', label: 'Foto tras la instalación', type: 'image' },
        { name: 'EndDate3', label: 'Fin de instalación', type: 'dateTime' },
        { name: 'Observ3', label: 'Observaciones', type: 'textarea' }
      ]
    },
    {
      id: 'hidroline', title: 'Hidroline', short: 'Hidroline', icon: 'i-pipe',
      fields: [
        { name: 'Num_Ident4', label: 'Número de identificación', type: 'text', hint: 'Identificador del cuadro asignado en taller.' },
        { name: 'Date4', label: 'Inicio de instalación', type: 'dateTime' },
        { name: 'Foto_Ini_HIDROLINE', label: 'Foto estado previo', type: 'image' },
        { name: 'Foto_Pic_HIDROLINE', label: 'Foto de los picajes', type: 'image' },
        { name: 'Foto_fin_HIDROLINE', label: 'Foto tras la instalación', type: 'image' },
        { name: 'EndDate4', label: 'Fin de instalación', type: 'dateTime' },
        { name: 'Observ4', label: 'Observaciones', type: 'textarea' }
      ]
    },
    {
      id: 'dosif', title: 'Dosificador de cloro', short: 'Cloro', icon: 'i-drop',
      fields: [
        { name: 'Num_serie5', label: 'Número de serie', type: 'barcode' },
        // En el XLSForm esta pregunta repite el nombre Foto_fin_PLACA (duplicado con Placa solar).
        { name: 'Foto_fin_DOSIF', label: 'Foto tras la instalación', type: 'image' },
        { name: 'EndDate5', label: 'Fin de instalación', type: 'dateTime' },
        { name: 'Observ5', label: 'Observaciones / incidencias', type: 'textarea' }
      ]
    },
    {
      id: 'placa', title: 'Placa solar', short: 'Placa', icon: 'i-solar',
      fields: [
        { name: 'Num_serie6', label: 'Número de serie', type: 'barcode' },
        { name: 'Foto_fin_PLACA', label: 'Foto tras la instalación', type: 'image' },
        { name: 'EndDate6', label: 'Fin de instalación', type: 'dateTime' },
        { name: 'Observ6', label: 'Observaciones', type: 'textarea' }
      ]
    },
    {
      id: 'contador', title: 'Contadores', short: 'Contador', icon: 'i-meter',
      hint: 'Características del contador instalado.',
      fields: [
        { name: 'tipo_contador', label: 'Tipo de contador', type: 'select_one', list: 'list_tipo_contador' },
        { name: 'Num_serie7', label: 'Número de serie', type: 'barcode' },
        { name: 'Model7', label: 'Modelo', type: 'text' },
        { name: 'DN', label: 'Diámetro nominal (DN)', type: 'integer', unit: 'mm' },
        { name: 'Data_fab', label: 'Fecha de fabricación', type: 'date' },
        { name: 'Date7', label: 'Fecha y hora de instalación', type: 'dateTime' },
        { name: 'Lect_actual', label: 'Lectura actual', type: 'decimal', unit: 'm³' },
        { name: 'Foto_Ini_CONT', label: 'Foto estado previo', type: 'image' },
        { name: 'Foto_fin_CONT', label: 'Foto tras la instalación', type: 'image' },
        { name: 'Foto_Detall_Contador', label: 'Foto de detalle del contador', type: 'image' },
        { name: 'EndDate7', label: 'Fin de instalación', type: 'dateTime' },
        { name: 'Observ7', label: 'Observaciones', type: 'textarea' }
      ]
    },
    {
      id: 'gtw', title: 'Gateways', short: 'Gateway', icon: 'i-antenna',
      fields: [
        { name: 'Model_GTW', label: 'Modelo', type: 'select_one', list: 'list_GTW' },
        { name: 'Num_Serie_GTW', label: 'Número de serie', type: 'barcode' },
        { name: 'NodeID', label: 'NodeID', type: 'barcode' },
        { name: 'NodeLora', label: 'NodeLoRa', type: 'barcode' },
        { name: 'Imei', label: 'IMEI', type: 'barcode' },
        { name: 'Date_GTW', label: 'Inicio de instalación', type: 'dateTime' },
        // En el XLSForm estas tres fotos estaban en grupos de repetición (tablas relacionadas).
        // Aquí se guardan como varios adjuntos del mismo registro.
        { name: 'Foto_Ini_GTW', label: 'Fotos estado previo', type: 'image', max: 10, hint: 'Haz solo las fotos necesarias.' },
        { name: 'Foto_pegatina', label: 'Fotos de la pegatina', type: 'image', max: 10 },
        { name: 'Foto_fin_GTW', label: 'Fotos tras la instalación', type: 'image', max: 10 },
        { name: 'EndDate_GTW', label: 'Hora fin de instalación', type: 'time' },
        { name: 'Observ_GTW', label: 'Observaciones', type: 'textarea' }
      ]
    }
  ]
};
