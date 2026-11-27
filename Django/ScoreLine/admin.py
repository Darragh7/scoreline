from django.contrib import admin

from .models import ContactMessage


@admin.register(ContactMessage)
class ContactMessageAdmin(admin.ModelAdmin):
    list_display = ("created_at", "full_name", "email", "subject", "rating")
    list_filter = ("subject", "rating")
    search_fields = ("full_name", "email", "message")
    readonly_fields = ("created_at",)
