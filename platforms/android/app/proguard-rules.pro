# Regras do R8 para o IPTVKZ. As bibliotecas (Media3, Play In-App Updates) trazem as próprias regras.

# Pontes chamadas pela página (window.IPTVKZAndroid, window.IPTVKZVideo): o R8 não vê essas chamadas,
# então os métodos com @JavascriptInterface ficam com o nome e não são removidos.
-keepattributes JavascriptInterface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Linhas certas nos relatórios de falha da Play (o nome do arquivo fica escondido).
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
